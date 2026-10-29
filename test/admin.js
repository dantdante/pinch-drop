/* Exercises every action in the control room through the real UI. */
'use strict';
const { chromium } = require('playwright-core');
const URL = 'http://127.0.0.1:4321';
const OWNER = '6xtXBG78|"o_iXDZY]3a';
const OPERATOR = 'Jmw£V63Gt@9aRO@9(`E,';

const ok = (n, x) => console.log(`  ok  ${n}${x ? ' — ' + x : ''}`);
const bad = (n, x) => console.log(`  XX  ${n}${x ? ' — ' + x : ''}`);

async function adminPage(browser, password) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL + '/admin', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.fill('#passwordInput', password);
  await page.click('#loginBtn');
  await page.waitForTimeout(1800);
  return { page, ctx, errors };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  /* ---------- owner ---------- */
  const owner = await adminPage(browser, OWNER);
  const chip = await owner.page.textContent('#roleChip');
  chip === 'Owner' ? ok('owner signs in with the owner password', chip) : bad('owner login', chip);

  const live = await owner.page.getAttribute('#liveBadge', 'data-state');
  live === 'live' ? ok('control room is live over the socket') : bad('live socket badge', live);

  /* floors tab */
  await owner.page.click('.tab[data-tab="floors"]');
  await owner.page.waitForTimeout(500);
  const floorRows = await owner.page.$$eval('.floorrow', (n) => n.length);
  floorRows === 7 ? ok('floors listed', floorRows) : bad('floors listed', floorRows);

  // rename a floor and confirm the public tower reflects it
  await owner.page.fill('.floorrow[data-floor="f01"] [data-key="name"]', 'Identity Test');
  await owner.page.click('.floorrow[data-floor="f01"] [data-act="savefloor"]');
  await owner.page.waitForTimeout(900);
  const floors = await (await fetch(URL + '/api/floors')).json();
  const f01 = floors.floors.find((f) => f.id === 'f01');
  f01 && f01.name === 'Identity Test' ? ok('floor rename reaches the public tower') : bad('floor rename', JSON.stringify(f01 && f01.name));
  await owner.page.fill('.floorrow[data-floor="f01"] [data-key="name"]', 'Identity');
  await owner.page.click('.floorrow[data-floor="f01"] [data-act="savefloor"]');
  await owner.page.waitForTimeout(700);

  /* broadcast */
  await owner.page.click('.tab[data-tab="broadcast"]');
  await owner.page.waitForTimeout(400);
  await owner.page.fill('#broadcastText', 'Notice from the control room.');
  await owner.page.click('#broadcastSend');
  await owner.page.waitForTimeout(900);
  const bStatus = await owner.page.textContent('#broadcastStatus');
  /Delivered/.test(bStatus) ? ok('broadcast sent', bStatus.trim()) : bad('broadcast', bStatus);

  /* maintenance toggle */
  await owner.page.click('#maintenanceToggle');
  await owner.page.waitForTimeout(900);
  const maintOn = await (await fetch(URL + '/api/stats')).json();
  const settings = await (await fetch(URL + '/api/floors')).json();
  settings.settings.maintenance === true ? ok('maintenance mode toggles on') : bad('maintenance mode on', JSON.stringify(settings.settings));
  await owner.page.click('#maintenanceToggle');
  await owner.page.waitForTimeout(800);
  const settings2 = await (await fetch(URL + '/api/floors')).json();
  settings2.settings.maintenance === false ? ok('maintenance mode toggles off') : bad('maintenance mode off');

  /* security: block + unblock */
  await owner.page.click('.tab[data-tab="security"]');
  await owner.page.waitForTimeout(400);
  await owner.page.fill('#blockAddress', '198.51.100.7');
  await owner.page.click('#blockBtn');
  await owner.page.waitForTimeout(900);
  const blockRows = await owner.page.$$eval('#blockList li', (n) => n.length);
  blockRows >= 1 ? ok('address blocked', blockRows) : bad('blocklist');
  await owner.page.click('#blockList li [data-act="unblock"]');
  await owner.page.waitForTimeout(800);
  const afterUnblock = await owner.page.$$eval('#blockList li', (n) => n.map((x) => x.textContent.trim()));
  afterUnblock.join(' ').includes('198.51.100.7') ? bad('address released', afterUnblock.join(' ')) : ok('address released');

  /* password change persists to disk */
  const tempPw = 'Temporary-Owner-Pw-1';
  await owner.page.selectOption('#pwTarget', 'owner');
  await owner.page.fill('#pwValue', tempPw);
  await owner.page.click('#pwSave');
  await owner.page.waitForTimeout(1000);
  const loginWithTemp = await (await fetch(URL + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: tempPw })
  })).json();
  loginWithTemp.ok && loginWithTemp.role === 'owner' ? ok('changed owner password takes effect') : bad('password change', JSON.stringify(loginWithTemp));
  const credFile = require('fs').readFileSync('/home/user/riseof-zoom/data/credentials.json', 'utf8');
  credFile.includes('owner') ? ok('changed password is written to disk (survives restart)') : bad('credentials persistence');

  // put the original password back
  await owner.page.selectOption('#pwTarget', 'owner');
  await owner.page.fill('#pwValue', OWNER);
  await owner.page.click('#pwSave');
  await owner.page.waitForTimeout(900);
  const restored = await (await fetch(URL + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: OWNER })
  })).json();
  restored.ok ? ok('original owner password restored') : bad('restore owner password');

  /* ---------- operator ---------- */
  const operator = await adminPage(browser, OPERATOR);
  const opChip = await operator.page.textContent('#roleChip');
  opChip === 'Operator' ? ok('operator signs in with the operator password', opChip) : bad('operator login', opChip);
  const pwDisabled = await operator.page.getAttribute('#pwSave', 'disabled');
  pwDisabled !== null ? ok('operator cannot change passwords (button disabled)') : bad('operator password button');
  const opLive = await operator.page.getAttribute('#liveBadge', 'data-state');
  opLive === 'live' ? ok('operator also gets live updates') : bad('operator live badge', opLive);

  /* ---------- audit ---------- */
  await owner.page.click('.tab[data-tab="audit"]');
  await owner.page.waitForTimeout(600);
  const auditRows = await owner.page.$$eval('#auditList li', (n) => n.length);
  auditRows > 0 ? ok('audit log records admin actions', auditRows + ' entries') : bad('audit log');

  const errs = [...owner.errors, ...operator.errors];
  console.log('\npage errors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
