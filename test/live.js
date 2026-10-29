/* ==========================================================
   Pinch Drop — live deployment test
   ----------------------------------------------------------
   Drives the real thing: the GitHub Pages site, talking to the
   Render backend over the public internet. Two browsers join
   the same room from the static origin and must see each
   other's video and hear each other's audio.

       node test/live.js
       LIVE_URL=https://dantdante.github.io/pinch-drop/ node test/live.js
   ========================================================== */

const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const SITE = process.env.LIVE_URL || 'https://dantdante.github.io/pinch-drop/';
const SHOTS = path.join(__dirname, '..', 'shots');
const OWNER = process.env.ADMIN_OWNER_PASSWORD || '6xtXBG78|"o_iXDZY]3a';

let passed = 0;
let failed = 0;

function check(label, condition, extra) {
  if (condition) {
    passed++;
    console.log('  ok  ' + label + (extra ? '  — ' + extra : ''));
  } else {
    failed++;
    console.log('  FAIL  ' + label + (extra ? '  — ' + extra : ''));
  }
  return !!condition;
}

/** Measures the real signal on a remote audio track. */
async function rms(page, id) {
  return page.evaluate(async (peerId) => {
    const peer = window.__pd.peers.get(peerId);
    if (!peer) return { ok: false, reason: 'no peer' };
    const stream = peer.stream || (peer.pc && peer.pc.remoteStream);
    if (!stream) return { ok: false, reason: 'no stream' };

    const track = stream.getAudioTracks()[0];
    if (!track) return { ok: false, reason: 'no audio track' };

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    let peak = 0;
    let samples = 0;
    for (let i = 0; i < 70; i++) {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let k = 0; k < buf.length; k++) sum += buf[k] * buf[k];
      const level = Math.sqrt(sum / buf.length);
      if (level > peak) peak = level;
      if (level > 0.01) samples++;
      await new Promise((r) => setTimeout(r, 50));
    }
    ctx.close();
    return { ok: true, peak, samples };
  }, id);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  console.log(`→ ${SITE}`);

  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox'
    ]
  });

  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errsA = [];
  const errsB = [];
  a.on('pageerror', (e) => errsA.push(String(e)));
  b.on('pageerror', (e) => errsB.push(String(e)));

  /* ---- the lobby on the live site ---- */
  await a.goto(SITE, { waitUntil: 'networkidle' });
  await a.waitForTimeout(3000);

  const noticeShown = await a.evaluate(() => {
    const n = document.querySelector('#apiNotice');
    return !!n && !n.hidden;
  });
  check('no unreachable notice — the live backend answered', !noticeShown);

  const floors = await a.evaluate(() => document.querySelectorAll('.floor').length);
  check('tower renders on the live site', floors >= 7, floors + ' floors');

  const liveCount = await a.evaluate(() => {
    const el = document.querySelector('#liveCount');
    return el ? el.textContent.trim() : '';
  });
  check('live counter came from the backend', liveCount !== '', 'count = ' + liveCount);

  const brand = await a.evaluate(() => {
    const img = document.querySelector('.brand__mark');
    const text = document.querySelector('.brand__text');
    return {
      src: img ? img.getAttribute('src') : null,
      loaded: img ? img.complete && img.naturalWidth > 0 : false,
      text: text ? text.textContent.replace(/\s+/g, ' ').trim() : ''
    };
  });
  check('brand shows the new logo', brand.loaded && /pinch-drop\.png/.test(brand.src || ''), brand.src || 'none');
  check('brand reads Pinch Drop', /Pinch\s*Drop/i.test(brand.text), brand.text);

  /* ---- two peers in the same room, from the static origin ---- */
  const roomUrl = SITE + 'room.html?room=f01';
  await a.goto(roomUrl, { waitUntil: 'networkidle' });
  await b.goto(roomUrl, { waitUntil: 'networkidle' });
  await a.waitForTimeout(2000);
  await b.waitForTimeout(2000);

  await a.click('#joinBtn');
  await a.waitForTimeout(3000);
  await b.click('#joinBtn');
  await b.waitForTimeout(2000);

  const joinedA = await a.evaluate(() => !!document.querySelector('#prejoin[hidden]') || document.querySelector('#prejoin').hidden);
  const joinedB = await b.evaluate(() => document.querySelector('#prejoin').hidden);
  check('peer A joined', joinedA);
  check('peer B joined', joinedB);

  const connA = await a.evaluate(() => {
    const el = document.querySelector('#connState');
    return el ? el.textContent.trim() : '';
  });
  check('peer A is connected to the Render backend', /connected/i.test(connA), connA);

  /* wait for the peer to show up and the media to flow */
  let peerId = null;
  for (let i = 0; i < 40 && !peerId; i++) {
    peerId = await a.evaluate(() => {
      const peers = window.__pd.peers;
      if (!peers || peers.size === 0) return null;
      return Array.from(peers.keys())[0];
    });
    if (!peerId) await a.waitForTimeout(1000);
  }
  check('peer A sees peer B', !!peerId, peerId || 'none');

  if (peerId) {
    await a.waitForTimeout(4000);

    const videoLive = await a.evaluate((id) => {
      const peer = window.__pd.peers.get(id);
      const stream = peer.stream || (peer.pc && peer.pc.remoteStream);
      if (!stream) return { ok: false, reason: 'no stream' };
      const track = stream.getVideoTracks()[0];
      return {
        ok: !!track && track.readyState === 'live',
        state: track ? track.readyState : 'none',
        w: track ? track.getSettings().width : 0
      };
    }, peerId);
    check('remote video track is live across the internet', videoLive.ok,
      videoLive.ok ? `${videoLive.w}px` : videoLive.reason);

    const audio = await rms(a, peerId);
    check('remote audio carries a real signal across the internet',
      audio.ok && audio.peak > 0.01,
      audio.ok ? `peak RMS ${audio.peak.toFixed(4)} over ${audio.samples} samples` : audio.reason);

    await a.screenshot({ path: path.join(SHOTS, '16-live-room.png') });
  }

  /* ---- the control room on the live site ---- */
  const admin = await ctxA.newPage();
  const adminErrs = [];
  admin.on('pageerror', (e) => adminErrs.push(String(e)));
  await admin.goto(SITE + 'admin.html', { waitUntil: 'networkidle' });
  await admin.waitForTimeout(1500);

  await admin.fill('#passwordInput', OWNER);
  await admin.click('#loginBtn');
  const signedIn = await admin
    .waitForSelector('#dash:not([hidden])', { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check('owner signs in to the live control room', signedIn);

  if (signedIn) {
    await admin.waitForTimeout(2500);
    const badge = await admin.evaluate(() => {
      const b = document.querySelector('#liveBadge');
      return b ? b.textContent.trim() : '';
    });
    check('control room is live over the socket', /live/i.test(badge), badge);

    const rooms = await admin.evaluate(() => document.querySelectorAll('#roomsTable tbody tr').length);
    check('the live rooms table is populated', rooms >= 1, rooms + ' rooms');

    await admin.screenshot({ path: path.join(SHOTS, '17-live-admin.png') });
  }

  check('page errors: none', errsA.length === 0 && errsB.length === 0 && adminErrs.length === 0,
    errsA.concat(errsB, adminErrs).join(' | ') || undefined);

  await browser.close();

  console.log('');
  console.log(`${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
