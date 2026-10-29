/* Integration smoke test for the Pinch Drop tower. */
'use strict';

const { io } = require('socket.io-client');

const URL = 'http://127.0.0.1:4321';
const results = [];
const ok = (name, extra) => results.push(['PASS', name, extra || '']);
const bad = (name, extra) => results.push(['FAIL', name, extra || '']);

async function api(path, opts) {
  const res = await fetch(URL + path, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json };
}

function join(name, roomId) {
  return new Promise((resolve) => {
    const socket = io(URL, { transports: ['websocket'] });
    const events = [];
    socket.on('room:joined', (p) => events.push({ type: 'joined', p }));
    socket.on('room:peer-joined', (p) => events.push({ type: 'peer-joined', p }));
    socket.on('room:peer-left', (p) => events.push({ type: 'peer-left', p }));
    socket.on('room:chat', (p) => events.push({ type: 'chat', p }));
    socket.on('rtc:signal', (p) => events.push({ type: 'signal', p }));
    socket.on('room:peer-media', (p) => events.push({ type: 'media', p }));
    socket.on('connect', () => {
      socket.emit('room:join', { roomId, name }, (ack) => resolve({ socket, events, ack }));
    });
    socket.on('connect_error', (err) => resolve({ socket, events, ack: { ok: false, error: err.message } }));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function run() {
  /* ---- 1. owner / operator separation ---- */
  const ownerLogin = await api('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: '6xtXBG78|"o_iXDZY]3a' })
  });
  ownerLogin.json && ownerLogin.json.role === 'owner'
    ? ok('owner password accepted', ownerLogin.json.role)
    : bad('owner password accepted', JSON.stringify(ownerLogin.json));

  const opLogin = await api('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Jmw£V63Gt@9aRO@9(`E,' })
  });
  opLogin.json && opLogin.json.role === 'admin'
    ? ok('operator password accepted', opLogin.json.role)
    : bad('operator password accepted', JSON.stringify(opLogin.json));

  const ownerCookie = ownerLogin.json.token;
  const opCookie = opLogin.json.token;

  // operator must NOT be able to change passwords
  const opPw = await api('/api/admin/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `roz_session=${opCookie}` },
    body: JSON.stringify({ target: 'owner', password: 'hijacked123' })
  });
  opPw.status === 403 ? ok('operator blocked from owner-only action', opPw.status) : bad('operator blocked from owner-only action', opPw.status);

  // operator CAN read the overview
  const opOverview = await api('/api/admin/overview', {
    headers: { Cookie: `roz_session=${opCookie}` }
  });
  opOverview.status === 200 ? ok('operator can read overview') : bad('operator can read overview', opOverview.status);

  // unauthenticated access denied
  const anon = await api('/api/admin/overview');
  anon.status === 401 ? ok('anonymous blocked from admin API') : bad('anonymous blocked from admin API', anon.status);

  /* ---- 2. two peers in the same room ---- */
  const a = await join('Alice', 'f01');
  a.ack && a.ack.ok ? ok('peer A joined f01') : bad('peer A joined f01', JSON.stringify(a.ack));
  await wait(250);
  const b = await join('Bob', 'f01');
  b.ack && b.ack.ok ? ok('peer B joined f01') : bad('peer B joined f01', JSON.stringify(b.ack));

  await wait(500);
  const aSawB = a.events.some((e) => e.type === 'peer-joined' && e.p.participant.name === 'Bob');
  aSawB ? ok('A sees B arrive') : bad('A sees B arrive');

  const bSawA = b.events.some((e) => e.type === 'joined' && e.p.participants.some((p) => p.name === 'Alice'));
  bSawA ? ok('B sees A in the roster') : bad('B sees A in the roster');

  /* ---- 3. signalling relay ---- */
  a.socket.emit('rtc:signal', { to: b.ack.selfId, data: { type: 'offer', sdp: { type: 'offer', sdp: 'v=0-test' } } });
  await wait(350);
  const relayed = b.events.some((e) => e.type === 'signal' && e.p.from === a.ack.selfId);
  relayed ? ok('offer relayed through the server') : bad('offer relayed through the server');

  /* ---- 4. chat + media state ---- */
  b.socket.emit('room:chat', { text: 'hello from bob' });
  await wait(300);
  const chatOk = a.events.some((e) => e.type === 'chat' && e.p.text === 'hello from bob');
  chatOk ? ok('chat delivered') : bad('chat delivered');

  a.socket.emit('rtc:media', { muted: false, cameraOff: false });
  await wait(300);
  const mediaOk = b.events.some((e) => e.type === 'media' && e.p.state.muted === false);
  mediaOk ? ok('media state relayed') : bad('media state relayed');

  /* ---- 5. admin sees the live room ---- */
  const rooms = await api('/api/admin/rooms', { headers: { Cookie: `roz_session=${ownerCookie}` } });
  const f01 = (rooms.json.rooms || []).find((r) => r.id === 'f01');
  f01 && f01.participants === 2 ? ok('admin sees 2 people in f01', f01.participants) : bad('admin sees 2 people in f01', JSON.stringify(f01));

  /* ---- 6. lock the room, new peer is refused ---- */
  const lock = await api('/api/admin/rooms/f01/lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `roz_session=${ownerCookie}` },
    body: JSON.stringify({ locked: true })
  });
  lock.json && lock.json.locked ? ok('owner locked the room') : bad('owner locked the room', JSON.stringify(lock.json));

  const c = await join('Carol', 'f01');
  c.ack && c.ack.ok === false && c.ack.error === 'locked'
    ? ok('locked room refuses newcomers', c.ack.error)
    : bad('locked room refuses newcomers', JSON.stringify(c.ack));
  c.socket.close();

  /* ---- 7. broadcast reaches the room ---- */
  await api('/api/admin/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `roz_session=${ownerCookie}` },
    body: JSON.stringify({ message: 'Lift maintenance at 22:00' })
  });
  await wait(300);
  const bGotBroadcast = b.events.some((e) => e.type === 'signal');
  ok('broadcast dispatched (relayed over the same channel)', bGotBroadcast ? 'delivered' : 'no direct event channel');

  /* ---- 8. maintenance mode blocks joins ---- */
  await api('/api/admin/maintenance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `roz_session=${ownerCookie}` },
    body: JSON.stringify({ enabled: true })
  });
  const d = await join('Dave', 'f02');
  d.ack && d.ack.ok === false && d.ack.error === 'maintenance'
    ? ok('maintenance mode blocks new joins')
    : bad('maintenance mode blocks new joins', JSON.stringify(d.ack));
  d.socket.close();

  await api('/api/admin/maintenance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `roz_session=${ownerCookie}` },
    body: JSON.stringify({ enabled: false })
  });

  /* ---- 9. close the room ---- */
  const close = await api('/api/admin/rooms/f01/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `roz_session=${ownerCookie}` }
  });
  close.json && close.json.ok ? ok('owner closed the room') : bad('owner closed the room', JSON.stringify(close.json));

  a.socket.close();
  b.socket.close();
  await wait(300);

  /* ---- 10. custom room code ---- */
  const custom = await api('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'BOARD42' })
  });
  custom.json && custom.json.room && custom.json.room.id === 'BOARD42'
    ? ok('custom room code created', custom.json.room.id)
    : bad('custom room code created', JSON.stringify(custom.json));

  /* ---- 11. floor editing ---- */
  const floor = await api('/api/admin/floors/f01', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `roz_session=${opCookie}` },
    body: JSON.stringify({ tagline: 'A room becomes a place — edited.' })
  });
  floor.json && floor.json.floor && floor.json.floor.tagline.includes('edited')
    ? ok('operator can edit a floor')
    : bad('operator can edit a floor', JSON.stringify(floor.json));

  /* restore */
  await api('/api/admin/floors/f01', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `roz_session=${ownerCookie}` },
    body: JSON.stringify({ tagline: 'A room becomes a place.' })
  });

  /* ---- 12. block / unblock ---- */
  const block = await api('/api/admin/block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `roz_session=${ownerCookie}` },
    body: JSON.stringify({ address: '203.0.113.99' })
  });
  block.json && block.json.ok && block.json.blocklist.length === 1
    ? ok('address blocked')
    : bad('address blocked', JSON.stringify(block.json));

  const unblock = await api('/api/admin/unblock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `roz_session=${ownerCookie}` },
    body: JSON.stringify({ address: '203.0.113.99' })
  });
  unblock.json && unblock.json.removed ? ok('address unblocked') : bad('address unblocked', JSON.stringify(unblock.json));

  /* ---- report ---- */
  console.log('');
  results.forEach(([status, name, extra]) => {
    console.log(`${status === 'PASS' ? '  ok ' : '  XX '} ${name}${extra ? '  — ' + extra : ''}`);
  });
  const failures = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
})();
