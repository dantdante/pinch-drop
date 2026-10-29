'use strict';

const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

/* ------------------------------------------------------------------ */
/* Persistent floor configuration                                       */
/* ------------------------------------------------------------------ */

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  if (!config.PERSISTENT) return;
  try {
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch (_) {
    /* non fatal */
  }
}

let floors = readJson(config.FLOORS_FILE, null);
if (!Array.isArray(floors) || !floors.length) {
  floors = config.DEFAULT_FLOORS.map((f) => Object.assign({}, f));
  writeJson(config.FLOORS_FILE, floors);
}

let settings = Object.assign(
  { maintenance: false, maintenanceMessage: 'The tower is under maintenance. Please try again shortly.' },
  readJson(config.SETTINGS_FILE, {})
);

let blocklist = readJson(config.BLOCKLIST_FILE, []);

function getFloors() {
  return floors.map((f) => Object.assign({}, f));
}

function getFloor(id) {
  return floors.find((f) => f.id === id) || null;
}

function getFloorByLevel(level) {
  return floors.find((f) => f.level === level) || null;
}

function updateFloor(id, patch) {
  const floor = floors.find((f) => f.id === id);
  if (!floor) return null;
  const allowed = ['name', 'nameTr', 'tagline', 'taglineTr', 'body', 'bodyTr', 'accent', 'enabled'];
  for (const key of allowed) {
    if (patch[key] !== undefined) floor[key] = patch[key];
  }
  writeJson(config.FLOORS_FILE, floors);
  return Object.assign({}, floor);
}

function getSettings() {
  return Object.assign({}, settings);
}

function updateSettings(patch) {
  settings = Object.assign({}, settings, patch);
  writeJson(config.SETTINGS_FILE, settings);
  return getSettings();
}

function getBlocklist() {
  return blocklist.slice();
}

function blockAddress(address, reason) {
  if (!address) return false;
  const clean = String(address).trim();
  if (!clean) return false;
  if (!blocklist.some((b) => b.address === clean)) {
    blocklist.push({ address: clean, reason: reason || 'blocked by administrator', at: new Date().toISOString() });
    writeJson(config.BLOCKLIST_FILE, blocklist);
  }
  return true;
}

function unblockAddress(address) {
  const before = blocklist.length;
  blocklist = blocklist.filter((b) => b.address !== address);
  if (blocklist.length !== before) writeJson(config.BLOCKLIST_FILE, blocklist);
  return before !== blocklist.length;
}

function isBlocked(address) {
  if (!address) return false;
  return blocklist.some((b) => b.address === String(address).trim());
}

/* ------------------------------------------------------------------ */
/* Live room registry                                                   */
/* ------------------------------------------------------------------ */

/** roomId -> { id, kind, participants: Map<id, participant>, createdAt, locked } */
const rooms = new Map();

function ensureRoom(id, kind) {
  let room = rooms.get(id);
  if (!room) {
    room = {
      id,
      kind: kind || 'custom',
      createdAt: Date.now(),
      locked: false,
      closed: false,
      participants: new Map()
    };
    rooms.set(id, room);
  }
  return room;
}

function getRoom(id) {
  return rooms.get(id) || null;
}

function listRooms() {
  return Array.from(rooms.values()).map((room) => ({
    id: room.id,
    kind: room.kind,
    createdAt: room.createdAt,
    locked: room.locked,
    closed: room.closed,
    participants: room.participants.size,
    details: Array.from(room.participants.values()).map((p) => ({
      id: p.id,
      name: p.name,
      joinedAt: p.joinedAt,
      muted: p.muted,
      cameraOff: p.cameraOff,
      sharing: p.sharing,
      handRaised: p.handRaised,
      address: p.address,
      agent: p.agent
    }))
  }));
}

function closeRoom(id) {
  const room = rooms.get(id);
  if (!room) return null;
  room.closed = true;
  room.participants.clear();
  rooms.delete(id);
  return room;
}

function lockRoom(id, locked) {
  const room = rooms.get(id);
  if (!room) return null;
  room.locked = !!locked;
  return room;
}

function removeParticipant(roomId, participantId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const participant = room.participants.get(participantId);
  room.participants.delete(participantId);
  if (room.participants.size === 0 && room.kind === 'custom') {
    rooms.delete(roomId);
  }
  return participant || null;
}

function newRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from(crypto.randomBytes(6))
      .map((b) => alphabet[b % alphabet.length])
      .join('');
  } while (rooms.has(code.toLowerCase()));
  return code;
}

function stats() {
  let participants = 0;
  for (const room of rooms.values()) participants += room.participants.size;
  return {
    rooms: rooms.size,
    participants,
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    floors: floors.length,
    blocked: blocklist.length
  };
}

module.exports = {
  getFloors,
  getFloor,
  getFloorByLevel,
  updateFloor,
  getSettings,
  updateSettings,
  getBlocklist,
  blockAddress,
  unblockAddress,
  isBlocked,
  ensureRoom,
  getRoom,
  listRooms,
  closeRoom,
  lockRoom,
  removeParticipant,
  newRoomCode,
  stats,
  readJson,
  writeJson
};
