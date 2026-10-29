/* ==========================================================
   Pinch Drop — static-host resilience
   ----------------------------------------------------------
   When the lobby is served from a static host (GitHub Pages)
   and the signalling server cannot be reached, the tower
   must still render in full from the built-in fallback
   catalogue and show a clear notice.

       node test/offline.js
   ========================================================== */

const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4321';
const SHOTS = path.join(__dirname, '..', 'shots');

let passed = 0;
let failed = 0;

function ok(label, extra) {
  passed++;
  console.log('  ok  ' + label + (extra ? '  — ' + extra : ''));
}

function bad(label, extra) {
  failed++;
  console.log('  FAIL  ' + label + (extra ? '  — ' + extra : ''));
}

function check(label, condition, extra) {
  condition ? ok(label, extra) : bad(label, extra);
  return !!condition;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox']
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // Simulate the signalling server being unreachable: every /api call fails.
  await page.route('**/api/**', (route) => route.abort('failed'));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const noticeVisible = await page.evaluate(() => {
    const n = document.querySelector('#apiNotice');
    if (!n) return false;
    const style = window.getComputedStyle(n);
    return !n.hidden && style.opacity !== '0' && style.display !== 'none';
  });
  check('unreachable-backend notice is shown', noticeVisible);

  const noticeText = await page.evaluate(() => {
    const n = document.querySelector('#apiNotice');
    return n ? n.innerText.replace(/\s+/g, ' ').trim() : '';
  });
  check(
    'notice explains the problem',
    /unreachable/i.test(noticeText) && /apiBase|config\.js/i.test(noticeText),
    noticeText.slice(0, 90)
  );

  // The tower must still render every floor from the fallback catalogue.
  const rendered = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.floor'));
    return nodes.map((n) => ({
      // ".f-level" renders as "01 · Identity"
      label: ((n.querySelector('.f-level') || {}).textContent || '').trim(),
      tagline: ((n.querySelector('.display--floor') || {}).textContent || '').trim()
    }));
  });
  check(
    'fallback catalogue renders all seven floors',
    rendered.length >= 7,
    rendered.map((f) => f.label).join(' ') || 'none'
  );

  const labels = rendered.map((f) => f.label).join(' ');
  check(
    'fallback carries the real floor names',
    /Identity/.test(labels) && /Design/.test(labels) && /Boardroom/.test(labels),
    labels.replace(/\s+/g, ' ').slice(0, 80)
  );

  check(
    'fallback carries the floor copy',
    rendered.some((f) => /A room becomes a place/.test(f.tagline)),
    rendered[0] ? rendered[0].tagline.slice(0, 50) : 'none'
  );

  // The retry button must reload the tower.
  const retryVisible = await page.evaluate(() => {
    const b = document.querySelector('#apiNoticeRetry');
    return !!b && b.offsetParent !== null;
  });
  check('notice offers a retry', retryVisible);

  await page.click('#apiNoticeRetry');
  await page.waitForTimeout(1200);
  const stillThere = await page.evaluate(() => {
    const n = document.querySelector('#apiNotice');
    return !!n && !n.hidden;
  });
  check('retry keeps trying while the backend is down', stillThere);

  // The dismiss button must work.
  await page.click('#apiNoticeClose');
  await page.waitForTimeout(300);
  const dismissed = await page.evaluate(() => {
    const n = document.querySelector('#apiNotice');
    return !n || n.hidden;
  });
  check('notice can be dismissed', dismissed);

  // A hanging request means the backend is asleep, not missing.
  const slow = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await slow.route('**/api/**', async (route) => {
    await new Promise((r) => setTimeout(r, 30000));
    route.abort('failed');
  });
  await slow.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await slow.waitForTimeout(17000);
  const wakingText = await slow.evaluate(() => {
    const n = document.querySelector('#apiNoticeText');
    return n ? n.innerText.replace(/\s+/g, ' ').trim() : '';
  });
  check(
    'a hanging request is reported as the server waking up',
    /waking up/i.test(wakingText),
    wakingText.slice(0, 70)
  );
  const isWaking = await slow.evaluate(() => {
    const n = document.querySelector('#apiNotice');
    return !!n && n.classList.contains('is-waking');
  });
  check('the waking-up notice is styled differently', isWaking);
  await slow.close();

  await page.screenshot({ path: path.join(SHOTS, '14-offline-notice.png') });

  // Now with the backend reachable again the notice must stay hidden.
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors2 = [];
  page2.on('pageerror', (e) => errors2.push(String(e)));
  await page2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(2000);
  const hidden = await page2.evaluate(() => {
    const n = document.querySelector('#apiNotice');
    return !n || n.hidden;
  });
  check('no notice when the backend is reachable', hidden);

  const live = await page2.evaluate(() => document.querySelectorAll('.floor').length);
  check('live catalogue renders the tower', live >= 7, live + ' floors');

  check('page errors: none', pageErrors.length === 0 && errors2.length === 0,
    pageErrors.concat(errors2).join(' | ') || undefined);

  await browser.close();

  console.log('');
  console.log(`${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
