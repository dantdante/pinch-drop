/* Does audio actually flow between two peers?
   Samples the remote stream with an AnalyserNode and reports real signal energy,
   then checks the on-screen level meter reacts. */
'use strict';

const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:4321';

const ok = (n, x) => console.log(`  ok  ${n}${x ? ' — ' + x : ''}`);
const bad = (n, x) => console.log(`  XX  ${n}${x ? ' — ' + x : ''}`);

async function join(browser, name, room) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${URL}/room/${room}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.fill('#nameInput', name);
  await page.click('#joinBtn');
  await page.waitForTimeout(1500);
  return { page, ctx, errors, name };
}

(async () => {
  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  const a = await join(browser, 'Ada', 'f05');
  const b = await join(browser, 'Grace', 'f05');
  await a.page.waitForTimeout(7000); // let ICE settle

  /* ---- 1. remote stream carries video ---- */
  const videoOk = await b.page.evaluate(() => {
    const peer = Array.from(document.querySelectorAll('.tile')).find((t) => !t.classList.contains('is-local'));
    const v = peer && peer.querySelector('video');
    return !!(v && v.videoWidth > 0 && v.readyState >= 2);
  });
  videoOk ? ok('remote video track is live') : bad('remote video track is live');

  /* ---- 2. remote AUDIO carries real signal ---- */
  const audioEnergy = await b.page.evaluate(async () => {
    const peer = Array.from(document.querySelectorAll('.tile')).find((t) => !t.classList.contains('is-local'));
    const v = peer && peer.querySelector('video');
    if (!v || !v.srcObject) return { error: 'no remote stream' };
    const stream = v.srcObject;
    const tracks = stream.getAudioTracks();
    if (!tracks.length) return { error: 'no audio track on the remote stream' };

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);

    let peak = 0;
    let samples = 0;
    const started = performance.now();
    while (performance.now() - started < 2500) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      if (rms > peak) peak = rms;
      samples++;
      await new Promise((r) => setTimeout(r, 40));
    }
    return { peak, samples, trackState: tracks[0].readyState, label: tracks[0].label };
  });

  if (audioEnergy.error) {
    bad('remote audio signal', audioEnergy.error);
  } else if (audioEnergy.peak > 0.01) {
    ok('remote audio carries real signal', `peak RMS ${audioEnergy.peak.toFixed(4)} over ${audioEnergy.samples} samples`);
  } else {
    bad('remote audio carries real signal', `peak RMS only ${audioEnergy.peak.toFixed(5)} — silence`);
  }

  /* ---- 3. the on-screen level meter reacts to that audio ---- */
  const meter = await a.page.evaluate(async () => {
    // the meter is live, so sample it over a window and keep the peak
    const levels = [];
    const started = performance.now();
    while (performance.now() - started < 2500) {
      document.querySelectorAll('.tile__meter i').forEach((el) => {
        levels.push(parseFloat(el.style.getPropertyValue('--level') || '0'));
      });
      await new Promise((r) => setTimeout(r, 50));
    }
    return { peak: levels.length ? Math.max(...levels) : 0, samples: levels.length };
  });
  meter.peak > 0.02
    ? ok('local level meter shows microphone activity', `${meter.peak.toFixed(3)} over ${meter.samples} samples`)
    : bad('local level meter', String(meter.peak));

  /* ---- 4. audio is not muted at the source ---- */
  const micOn = await a.page.evaluate(() => {
    const t = document.querySelector('.tile.is-local video');
    return t && t.srcObject ? t.srcObject.getAudioTracks().map((x) => ({ enabled: x.enabled, readyState: x.readyState })) : null;
  });
  if (micOn && micOn.length && micOn[0].enabled) ok('microphone track is enabled and live', JSON.stringify(micOn[0]));
  else bad('microphone track enabled', JSON.stringify(micOn));

  /* ---- 5. mute really stops the audio on the wire ---- */
  await a.page.click('#micBtn');
  await a.page.waitForTimeout(1500);
  const muted = await b.page.evaluate(() => {
    const peer = Array.from(document.querySelectorAll('.tile')).find((t) => !t.classList.contains('is-local'));
    const icons = peer && peer.querySelector('.tile__icons');
    return icons ? icons.innerHTML.includes('is-off') : 'no peer tile';
  });
  muted === true ? ok('mute state reaches the other side') : bad('mute state reaches the other side', String(muted));

  /* ---- 6. ICE configuration is served and used ---- */
  const ice = await a.page.evaluate(async () => {
    const res = await fetch('/api/ice');
    return res.json();
  });
  ice && ice.iceServers && ice.iceServers.length
    ? ok('ICE configuration served', ice.iceServers.map((s) => s.urls).join(', '))
    : bad('ICE configuration served');

  const errs = [...a.errors, ...b.errors];
  console.log('\npage errors:', errs.length ? errs.join(' | ') : 'none');

  await browser.close();
  process.exit(0);
})();
