'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const auth = require('./auth');
const store = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 1e6
});

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(config.ROOT, 'public'), { extensions: ['html'] }));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const clientAddress = (socket) => {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return socket.handshake.address || 'unknown';
};

const safeName = (name) => {
  const clean = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32);
  return clean || 'Guest';
};

const adminSocketRoom = 'admins';

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get('/api/floors', (req, res) => {
  const floors = store.getFloors().map((floor) => {
    const room = store.getRoom(floor.id);
    return Object.assign({}, floor, {
      occupants: room ? room.participants.size : 0,
      locked: room ? room.locked : false
    });
  });
  res.json({ ok: true, floors, settings: store.getSettings() });
});

/**
 * ICE servers for the browser. Includes a TURN relay when one is configured on
 * the server, which is what makes calls work behind symmetric NAT.
 */
app.get('/api/ice', (req, res) => {
  res.json({ ok: true, iceServers: config.iceServers() });
});

app.get('/api/stats', (req, res) => {
  res.json({ ok: true, stats: store.stats() });
});

app.post('/api/rooms', (req, res) => {
  const body = req.body || {};
  const custom = String(body.code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  const code = custom || store.newRoomCode();
  const existing = store.getRoom(code);
  if (existing) {
    res.status(409).json({ ok: false, error: 'room_exists', room: { id: code } });
    return;
  }
  const floor = store.getFloorByLevel(code);
  const room = store.ensureRoom(code, floor ? 'floor' : 'custom');
  res.json({ ok: true, room: { id: room.id, kind: room.kind } });
});

app.get('/api/rooms/:id', (req, res) => {
  const room = store.getRoom(req.params.id);
  const floor = store.getFloor(req.params.id);
  res.json({
    ok: true,
    room: room
      ? { id: room.id, kind: room.kind, occupants: room.participants.size, locked: room.locked }
      : { id: req.params.id, kind: floor ? 'floor' : 'custom', occupants: 0, locked: false },
    floor: floor || null
  });
});

/* ------------------------------------------------------------------ */
/* Admin API                                                           */
/* ------------------------------------------------------------------ */

app.post('/api/admin/login', (req, res) => {
  const role = auth.authenticate((req.body || {}).password);
  if (!role) {
    auth.audit('login_failed', { ip: req.ip }, null);
    res.status(401).json({ ok: false, error: 'invalid_password' });
    return;
  }
  auth.setSessionCookie(res, role);
  auth.audit('login', { role }, role);
  // the token is also handed back for socket subscriptions (the cookie is httpOnly)
  res.json({ ok: true, role, token: auth.createSession(role) });
});

app.post('/api/admin/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  const session = auth.getSession(req);
  if (!session) {
    res.json({ ok: false, role: null });
    return;
  }
  res.json({ ok: true, role: session.role, token: auth.createSession(session.role) });
});

app.get('/api/admin/overview', auth.requireSession, (req, res) => {
  res.json({
    ok: true,
    role: req.session.role,
    stats: store.stats(),
    settings: store.getSettings(),
    floors: store.getFloors(),
    rooms: store.listRooms(),
    blocklist: store.getBlocklist(),
    audit: readAudit(120)
  });
});

app.get('/api/admin/rooms', auth.requireSession, (req, res) => {
  res.json({ ok: true, rooms: store.listRooms() });
});

app.post('/api/admin/rooms/:id/close', auth.requireSession, (req, res) => {
  const room = store.closeRoom(req.params.id);
  if (!room) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }
  io.to(req.params.id).emit('room:closed', { reason: 'Closed by an administrator.' });
  io.to(req.params.id).emit('server:broadcast', { message: 'This room has been closed by an administrator.' });
  io.sockets.sockets.forEach((s) => {
    if (s.rooms.has(req.params.id)) s.leave(req.params.id);
  });
  auth.audit('room_closed', { room: req.params.id, role: req.session.role }, req.session.role);
  notifyAdmins();
  res.json({ ok: true });
});

app.post('/api/admin/rooms/:id/lock', auth.requireSession, (req, res) => {
  const locked = !!(req.body || {}).locked;
  const room = store.lockRoom(req.params.id, locked);
  if (!room) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }
  io.to(req.params.id).emit('room:lock', { locked });
  auth.audit('room_lock', { room: req.params.id, locked }, req.session.role);
  notifyAdmins();
  res.json({ ok: true, locked });
});

app.post('/api/admin/broadcast', auth.requireSession, (req, res) => {
  const message = String((req.body || {}).message || '').trim().slice(0, 500);
  if (!message) {
    res.status(400).json({ ok: false, error: 'empty_message' });
    return;
  }
  io.emit('server:broadcast', { message, from: req.session.role });
  auth.audit('broadcast', { message }, req.session.role);
  res.json({ ok: true, delivered: store.stats().participants });
});

app.post('/api/admin/maintenance', auth.requireSession, (req, res) => {
  const enabled = !!(req.body || {}).enabled;
  const settings = store.updateSettings({ maintenance: enabled });
  io.emit('server:maintenance', settings);
  auth.audit('maintenance', { enabled }, req.session.role);
  res.json({ ok: true, settings });
});

app.post('/api/admin/floors/:id', auth.requireSession, (req, res) => {
  const floor = store.updateFloor(req.params.id, req.body || {});
  if (!floor) {
    res.status(404).json({ ok: false, error: 'not_found' });
    return;
  }
  io.emit('server:floors', { floor });
  auth.audit('floor_updated', { floor: req.params.id, patch: req.body }, req.session.role);
  res.json({ ok: true, floor });
});

app.post('/api/admin/block', auth.requireSession, (req, res) => {
  const address = String((req.body || {}).address || '').trim();
  if (!address) {
    res.status(400).json({ ok: false, error: 'missing_address' });
    return;
  }
  store.blockAddress(address, (req.body || {}).reason);
  for (const socket of io.sockets.sockets.values()) {
    if (clientAddress(socket) === address) {
      socket.emit('server:blocked', { reason: 'Your address has been blocked by an administrator.' });
      socket.leave(socket.data.roomId);
      socket.disconnect(true);
    }
  }
  auth.audit('block', { address }, req.session.role);
  notifyAdmins();
  res.json({ ok: true, blocklist: store.getBlocklist() });
});

app.post('/api/admin/unblock', auth.requireSession, (req, res) => {
  const address = String((req.body || {}).address || '');
  const removed = store.unblockAddress(address);
  auth.audit('unblock', { address, removed }, req.session.role);
  res.json({ ok: true, removed, blocklist: store.getBlocklist() });
});

app.post('/api/admin/password', auth.requireSession, auth.requireOwner, (req, res) => {
  const body = req.body || {};
  const target = body.target === 'admin' ? 'admin' : 'owner';
  if (!body.password || String(body.password).length < 6) {
    res.status(400).json({ ok: false, error: 'weak_password' });
    return;
  }
  auth.setPassword(target, String(body.password));
  auth.audit('password_changed', { target }, req.session.role);
  res.json({ ok: true });
});

app.post('/api/admin/kick', auth.requireSession, (req, res) => {
  const participantId = String((req.body || {}).participantId || '');
  const roomId = String((req.body || {}).roomId || '');
  let done = false;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.participantId === participantId && socket.data.roomId === roomId) {
      socket.emit('server:kicked', { reason: 'Removed from the room by an administrator.' });
      socket.leave(roomId);
      socket.disconnect(true);
      done = true;
    }
  }
  auth.audit('kick', { participantId, roomId, done }, req.session.role);
  res.json({ ok: true, kicked: done });
});

function readAudit(limit) {
  if (!config.PERSISTENT) return auth.auditLog.slice(0, limit);
  const fs = require('fs');
  try {
    const raw = fs.readFileSync(config.AUDIT_FILE, 'utf8').trim();
    if (!raw) return [];
    const lines = raw.split('\n').slice(-limit);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch (_) {
    return [];
  }
}

function notifyAdmins() {
  io.to(adminSocketRoom).emit('admin:refresh', { at: Date.now() });
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(config.ROOT, 'public', 'room.html'));
});

app.get(/^\/admin(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(config.ROOT, 'public', 'admin.html'));
});

/* ------------------------------------------------------------------ */
/* Socket.IO signalling                                                */
/* ------------------------------------------------------------------ */

/**
 * A single bad handler must never take the whole tower down. Socket.IO gives us
 * no per-listener isolation, so every listener is wrapped and the process keeps
 * a global net as well.
 */
function guarded(socket, handler) {
  return (...args) => {
    try {
      return handler(...args);
    } catch (err) {
      console.error('[socket]', err && err.message);
      const ack = args[args.length - 1];
      if (typeof ack === 'function') {
        try {
          ack({ ok: false, error: 'server_error' });
        } catch (_) {
          /* noop */
        }
      }
    }
  };
}

process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandled]', err && err.stack ? err.stack : err);
});

io.on('connection', (socket) => {
  const address = clientAddress(socket);
  socket.data.address = address;
  socket.data.joined = false;

  if (store.isBlocked(address)) {
    socket.emit('server:blocked', { reason: 'Your address has been blocked.' });
    socket.disconnect(true);
    return;
  }

  socket.on('admin:subscribe', guarded(socket, (payload, ack) => {
    const token = (payload || {}).token;
    const session = auth.verifyToken(token);
    if (!session) {
      if (typeof ack === 'function') ack({ ok: false });
      return;
    }
    socket.join(adminSocketRoom);
    socket.data.role = session.role;
    if (typeof ack === 'function') ack({ ok: true, role: session.role });
  }));

  socket.on('room:join', guarded(socket, (payload, ack) => {
    const roomId = String((payload || {}).roomId || '').trim();
    const name = safeName((payload || {}).name);

    if (!roomId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'bad_room' });
      return;
    }
    if (store.isBlocked(address)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'blocked' });
      return;
    }
    const settings = store.getSettings();
    if (settings.maintenance) {
      if (typeof ack === 'function') ack({ ok: false, error: 'maintenance', message: settings.maintenanceMessage });
      return;
    }

    const floor = store.getFloor(roomId);
    const room = store.ensureRoom(roomId, floor && floor.room ? 'floor' : 'custom');
    if (room.locked && !room.participants.has(socket.id)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'locked' });
      return;
    }
    if (room.participants.size >= config.MAX_PARTICIPANTS) {
      if (typeof ack === 'function') ack({ ok: false, error: 'full', capacity: config.MAX_PARTICIPANTS });
      return;
    }

    if (socket.data.roomId) leaveCurrentRoom(socket, 'switched');

    const participant = {
      id: socket.id,
      name,
      joinedAt: Date.now(),
      muted: true,
      cameraOff: false,
      sharing: false,
      handRaised: false,
      address,
      agent: (socket.handshake.headers['user-agent'] || '').slice(0, 160)
    };

    socket.data.roomId = room.id;
    socket.data.participantId = participant.id;
    socket.data.name = name;
    socket.join(room.id);
    room.participants.set(participant.id, participant);
    socket.data.joined = true;

    const others = Array.from(room.participants.values())
      .filter((p) => p.id !== participant.id)
      .map(publicParticipant);

    socket.emit('room:joined', {
      selfId: participant.id,
      roomId: room.id,
      kind: room.kind,
      participants: others,
      chat: room.chat || [],
      settings: store.getSettings(),
      serverTime: Date.now()
    });

    socket.to(room.id).emit('room:peer-joined', { participant: publicParticipant(participant) });

    if (typeof ack === 'function') ack({ ok: true, selfId: participant.id, participants: others });
    notifyAdmins();
  }));

  socket.on('rtc:signal', guarded(socket, (payload) => {
    const to = String((payload || {}).to || '');
    const data = (payload || {}).data;
    if (!to || !data) return;
    const target = io.sockets.sockets.get(to);
    if (!target) return;
    target.emit('rtc:signal', { from: socket.id, data });
  }));

  socket.on('rtc:media', guarded(socket, (payload) => {
    const room = store.getRoom(socket.data.roomId);
    if (!room) return;
    const participant = room.participants.get(socket.id);
    if (!participant) return;
    const state = payload || {};
    if (typeof state.muted === 'boolean') participant.muted = state.muted;
    if (typeof state.cameraOff === 'boolean') participant.cameraOff = state.cameraOff;
    if (typeof state.sharing === 'boolean') participant.sharing = state.sharing;
    if (typeof state.handRaised === 'boolean') participant.handRaised = state.handRaised;
    socket.to(room.id).emit('room:peer-media', { id: participant.id, state: payload });
  }));

  socket.on('room:chat', guarded(socket, (payload) => {
    const room = store.getRoom(socket.data.roomId);
    if (!room) return;
    const participant = room.participants.get(socket.id);
    if (!participant) return;
    const text = String((payload || {}).text || '').trim().slice(0, 800);
    if (!text) return;
    const message = {
      id: Math.random().toString(36).slice(2),
      from: participant.name,
      fromId: participant.id,
      text,
      at: Date.now()
    };
    if (!room.chat) room.chat = [];
    room.chat.push(message);
    if (room.chat.length > 120) room.chat.splice(0, room.chat.length - 120);
    io.to(room.id).emit('room:chat', message);
  }));

  socket.on('room:reaction', guarded(socket, (payload) => {
    const room = store.getRoom(socket.data.roomId);
    if (!room) return;
    const emoji = String((payload || {}).emoji || '').slice(0, 8);
    if (!emoji) return;
    socket.to(room.id).emit('room:reaction', { id: socket.id, name: socket.data.name, emoji });
  }));

  socket.on('room:raise-hand', guarded(socket, (payload) => {
    const room = store.getRoom(socket.data.roomId);
    if (!room) return;
    const raised = !!(payload || {}).raised;
    const participant = room.participants.get(socket.id);
    if (participant) participant.handRaised = raised;
    socket.to(room.id).emit('room:hand', { id: socket.id, raised });
  }));

  socket.on('room:leave', guarded(socket, () => {
    leaveCurrentRoom(socket, 'left');
  }));

  socket.on('disconnect', guarded(socket, () => {
    leaveCurrentRoom(socket, 'disconnected');
  }));
});

function publicParticipant(participant) {
  return {
    id: participant.id,
    name: participant.name,
    joinedAt: participant.joinedAt,
    muted: participant.muted,
    cameraOff: participant.cameraOff,
    sharing: participant.sharing,
    handRaised: participant.handRaised
  };
}

function leaveCurrentRoom(socket, reason) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = store.getRoom(roomId);
  socket.data.roomId = null;
  if (room) {
    room.participants.delete(socket.id);
    socket.to(roomId).emit('room:peer-left', { id: socket.id, reason });
    if (room.participants.size === 0 && room.kind === 'custom') {
      store.closeRoom(roomId);
    }
  }
  notifyAdmins();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ ok: false, error: 'server_error' });
});

server.listen(config.PORT, config.HOST, () => {
  console.log(`Rise of Zoom — tower online at http://${config.HOST}:${config.PORT}`);
});
