const { chromium } = require('playwright-core');
const URL = 'http://127.0.0.1:4321';
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ permissions: ['camera','microphone'] });
  const page = await ctx.newPage();
  await page.goto(URL + '/room/f01', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.fill('#nameInput', 'Ada Lovelace');
  await page.click('#joinBtn');
  await page.waitForTimeout(2500);
  const joined = await page.$$eval('.tile', n => n.length);
  console.log('tiles in room page:', joined);

  const login = await fetch(URL + '/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password:'6xtXBG78|"o_iXDZY]3a'})});
  const { token } = await login.json();
  const rooms = await fetch(URL + '/api/admin/rooms', { headers: { Cookie: 'roz_session=' + token } });
  const data = await rooms.json();
  console.log('admin sees rooms:', JSON.stringify(data.rooms.map(r => ({id:r.id, kind:r.kind, people:r.participants})), null, 1));

  // now open a second page and see if the room vanishes
  const admin = await ctx.newPage();
  await admin.goto(URL + '/admin', { waitUntil: 'networkidle' });
  await admin.waitForTimeout(1000);
  await admin.fill('#passwordInput', '6xtXBG78|"o_iXDZY]3a');
  await admin.click('#loginBtn');
  await admin.waitForTimeout(2500);
  const rows = await admin.$$eval('#roomsTable tbody tr', n => n.map(r => r.textContent.replace(/\s+/g,' ').trim()));
  console.log('admin rooms table:', JSON.stringify(rows));
  const tiles2 = await page.$$eval('.tile', n => n.length);
  console.log('tiles in room page after admin opened:', tiles2);
  await browser.close();
})();
