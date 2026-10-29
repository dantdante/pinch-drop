const { chromium } = require('playwright-core');
const URL = 'http://127.0.0.1:4321';
const ok = (n, x) => console.log(`  ok  ${n}${x ? ' — ' + x : ''}`);
const bad = (n, x) => console.log(`  XX  ${n}${x ? ' — ' + x : ''}`);
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera','microphone'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 1. elevator panel button navigates
  await page.click('.floor--hero .panel__btn[data-level="03"]');
  await page.waitForTimeout(2000);
  const level = await page.textContent('#indicatorLevel');
  level === '03' ? ok('lift button 03 took us to floor 03', level) : bad('lift button navigation', level);

  // 2. sound toggle
  await page.click('#soundToggle');
  await page.waitForTimeout(700);
  const soundLabel = await page.textContent('#soundLabel');
  const pressed = await page.getAttribute('#soundToggle', 'aria-pressed');
  (soundLabel === 'Sound on' && pressed === 'true') ? ok('sound toggle on', soundLabel) : bad('sound toggle', soundLabel);

  // 3. menu open/close
  await page.click('#menuToggle');
  await page.waitForTimeout(600);
  const menuVisible = await page.isVisible('#menu .menu__list');
  await page.click('#menuClose');
  await page.waitForTimeout(400);
  (menuVisible && !(await page.isVisible('#menu .menu__list'))) ? ok('menu opens and closes') : bad('menu toggle');

  // 4. enter a room via the floor button -> door transition -> room page
  await page.evaluate(() => {
    const s = document.querySelectorAll('.floor')[3];
    s.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await page.waitForTimeout(1800);
  await page.click('.floor:nth-of-type(4) .floor__foot .btn');
  await page.waitForTimeout(1600);
  const url = page.url();
  url.includes('/room/f03') ? ok('door transition navigates to the room', url.split('/').pop()) : bad('door transition navigation', url);

  // 5. join with the operator password in the admin
  const admin = await ctx.newPage();
  await admin.goto(URL + '/admin', { waitUntil: 'networkidle' });
  await admin.waitForTimeout(800);
  await admin.fill('#passwordInput', 'wrong-password');
  await admin.click('#loginBtn');
  await admin.waitForTimeout(1200);
  const note = await admin.textContent('#gateNote');
  note.includes('not accepted') ? ok('wrong password rejected') : bad('wrong password rejected', note);

  await admin.fill('#passwordInput', 'Jmw£V63Gt@9aRO@9(`E,');
  await admin.click('#loginBtn');
  await admin.waitForTimeout(2000);
  const role = await admin.textContent('#roleChip');
  const pwDisabled = await admin.getAttribute('#pwSave', 'disabled');
  role === 'Operator' ? ok('operator password signs in as Operator') : bad('operator role', role);
  pwDisabled !== null ? ok('operator cannot change passwords') : bad('operator password panel state');

  // 6. operator sees live data
  const statText = await admin.textContent('#statGrid');
  statText.toLowerCase().includes('rooms live') ? ok('operator sees live statistics') : bad('operator statistics', statText);

  console.log('\npage errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
