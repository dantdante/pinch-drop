const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto('http://127.0.0.1:4321/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/home/user/shots/01-lobby.png' });

  // scroll to a floor
  await page.evaluate(() => {
    const sections = document.querySelectorAll('.floor');
    sections[2].scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: '/home/user/shots/02-floor.png' });

  // menu
  await page.click('#menuToggle');
  await page.waitForTimeout(900);
  await page.screenshot({ path: '/home/user/shots/03-menu.png' });
  await page.click('#menuClose');
  await page.waitForTimeout(600);

  // room
  await page.goto('http://127.0.0.1:4321/room/f01', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/home/user/shots/04-prejoin.png' });

  await page.fill('#nameInput', 'Ada Lovelace');
  await page.click('#joinBtn');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '/home/user/shots/05-room.png' });

  // side panel
  await page.click('#peopleBtn');
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/home/user/shots/06-people.png' });

  // admin
  const admin = await ctx.newPage();
  admin.on('pageerror', (e) => errors.push('ADMIN PAGEERROR: ' + e.message));
  await admin.goto('http://127.0.0.1:4321/admin', { waitUntil: 'networkidle' });
  await admin.waitForTimeout(1200);
  await admin.screenshot({ path: '/home/user/shots/07-admin-login.png' });

  await admin.fill('#passwordInput', '6xtXBG78|"o_iXDZY]3a');
  await admin.click('#loginBtn');
  await admin.waitForTimeout(2000);
  await admin.screenshot({ path: '/home/user/shots/08-admin-overview.png' });

  await admin.click('.tab[data-tab="rooms"]');
  await admin.waitForTimeout(900);
  await admin.screenshot({ path: '/home/user/shots/09-admin-rooms.png' });

  await admin.click('.tab[data-tab="floors"]');
  await admin.waitForTimeout(900);
  await admin.screenshot({ path: '/home/user/shots/10-admin-floors.png' });

  await admin.click('.tab[data-tab="security"]');
  await admin.waitForTimeout(900);
  await admin.screenshot({ path: '/home/user/shots/11-admin-security.png' });

  console.log('ERRORS:', errors.length ? errors.join('\n  ') : 'none');
  await browser.close();
})();
