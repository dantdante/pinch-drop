const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ permissions: ['camera','microphone'] });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:4321/room/f05', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.fill('#nameInput', 'Ada');
  await p.click('#joinBtn');
  await p.waitForTimeout(2500);

  const res = await p.evaluate(async () => {
    const st = window.__roz;
    const out = { ctxState: st.audioCtx && st.audioCtx.state, meters: st.meters.size, localTracks: st.localStream ? st.localStream.getAudioTracks().length : 0 };
    // raw local stream analyser, sampled over time
    const ac = st.audioCtx;
    if (ac) {
      const src = ac.createMediaStreamSource(st.localStream);
      const an = ac.createAnalyser(); an.fftSize = 2048; src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 3000) {
        an.getByteTimeDomainData(buf);
        let sum = 0; for (const x of buf) { const y = (x-128)/128; sum += y*y; }
        peak = Math.max(peak, Math.sqrt(sum/buf.length));
        await new Promise(r => setTimeout(r, 40));
      }
      out.rawPeak = peak;
      out.ctxStateAfter = ac.state;
    }
    // what the app's own meter sees
    const lv = [];
    const t1 = performance.now();
    while (performance.now() - t1 < 1500) {
      document.querySelectorAll('.tile__meter i').forEach(el => lv.push(parseFloat(el.style.getPropertyValue('--level')||'0')));
      await new Promise(r => setTimeout(r, 50));
    }
    out.meterMax = Math.max(...lv);
    return out;
  });
  console.log(JSON.stringify(res, null, 2));
  await b.close();
})();
