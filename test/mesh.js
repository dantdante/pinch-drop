/* Two real browsers, one room: does the WebRTC mesh actually carry video? */
'use strict';

const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:4321';

async function joinAs(browser, name, room) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['camera', 'microphone']
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${URL}/room/${room}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.fill('#nameInput', name);
  await page.click('#joinBtn');
  await page.waitForTimeout(1200);
  return { page, ctx, errors, name };
}

(async () => {
  const browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files'
    ]
  });

  const a = await joinAs(browser, 'Ada', 'f02');
  const b = await joinAs(browser, 'Grace', 'f02');

  // give the mesh time to negotiate
  await a.page.waitForTimeout(6000);

  const probe = async (p) =>
    p.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.tile'));
      return tiles.map((t) => {
        const v = t.querySelector('video');
        return {
          id: t.dataset.id,
          local: t.classList.contains('is-local'),
          name: (t.querySelector('.tile__name') || {}).textContent,
          hasVideo: v ? v.videoWidth > 0 && v.readyState >= 2 : false,
          videoWidth: v ? v.videoWidth : 0,
          hasStream: v ? !!v.srcObject : false
        };
      });
    });

  const aTiles = await probe(a.page);
  const bTiles = await probe(b.page);

  console.log('\nAda sees:');
  aTiles.forEach((t) => console.log(`   ${t.local ? '[self]' : '[peer]'} ${t.name}  video=${t.hasVideo} (${t.videoWidth}px)`));
  console.log('Grace sees:');
  bTiles.forEach((t) => console.log(`   ${t.local ? '[self]' : '[peer]'} ${t.name}  video=${t.hasVideo} (${t.videoWidth}px)`));

  // chat across the mesh
  await a.page.click('#chatBtn');
  await b.page.click('#chatBtn');
  await a.page.click('.side__tab[data-tab="chat"]');
  await b.page.click('.side__tab[data-tab="chat"]');
  await a.page.waitForTimeout(400);
  await a.page.fill('#chatInput', 'Signal check: one, two.');
  await a.page.press('#chatInput', 'Enter');
  await b.page.waitForTimeout(1200);
  const bChat = await b.page.$$eval('.chat__msg', (n) => n.map((x) => x.textContent.trim()));
  console.log('\nGrace chat panel:', JSON.stringify(bChat));

  // reaction
  await a.page.click('.dock__btn--emoji');
  await b.page.waitForTimeout(900);
  const bFloaters = await b.page.$$eval('.floater', (n) => n.length);
  console.log('Grace saw floating reactions:', bFloaters);

  // mute state propagates
  await a.page.click('#micBtn');
  await b.page.waitForTimeout(1000);
  const bMicState = await b.page.evaluate(() => {
    const peer = Array.from(document.querySelectorAll('.tile')).find((t) => !t.classList.contains('is-local'));
    return peer ? peer.querySelector('.tile__icons').innerHTML.includes('is-off') : 'no peer tile';
  });
  console.log('Grace sees Ada muted:', bMicState);

  await a.page.screenshot({ path: '/home/user/shots/12-two-peers-a.png' });
  await b.page.screenshot({ path: '/home/user/shots/13-two-peers-b.png' });

  const errors = [...a.errors, ...b.errors];
  console.log('\nPage errors:', errors.length ? errors.join(' | ') : 'none');

  const ok = aTiles.some((t) => !t.local && t.hasVideo) && bTiles.some((t) => !t.local && t.hasVideo);
  console.log(ok ? '\nRESULT: peer-to-peer video flows in both directions' : '\nRESULT: peer video did not connect');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
