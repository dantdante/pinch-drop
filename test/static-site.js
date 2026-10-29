/* ==========================================================
   Rise of Zoom — static host end-to-end test
   ----------------------------------------------------------
   Proves the GitHub Pages deployment works: the site is built
   as plain files, served from a different origin than the
   signalling server, and it still works — tower, room and
   control room included.

       node test/static-site.js
   ========================================================== */

const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKEND = process.env.BASE_URL || 'http://127.0.0.1:4321';
const SITE_PORT = Number(process.env.SITE_PORT || 4400);
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const OUT = path.join(ROOT, 'test', '.static-build');

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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serve(dir) {
  return http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(dir, url);
    if (url === '/' || url.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

(async () => {
  /* 1 · build the static site against the running backend */
  console.log('→ building the static site');
  execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'build-pages.js'), '--api-base', BACKEND, '--out', OUT],
    { stdio: 'pipe' }
  );
  check('static site builds', fs.existsSync(path.join(OUT, 'index.html')));

  const cfg = fs.readFileSync(path.join(OUT, 'config.js'), 'utf8');
  check('build points at the backend', cfg.includes(`apiBase: '${BACKEND}'`), BACKEND);
  check('build is flagged static', /^\s*static:\s*true/m.test(cfg));

  /* 2 · serve it from its own origin */
  const server = serve(OUT);
  await new Promise((resolve) => server.listen(SITE_PORT, '127.0.0.1', resolve));

  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox']
  });
  const pageErrors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  /* 3 · the lobby */
  await page.goto(SITE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const floors = await page.evaluate(() => document.querySelectorAll('.floor').length);
  check('lobby renders the tower from a static origin', floors >= 7, floors + ' floors');

  const noticeHidden = await page.evaluate(() => {
    const n = document.querySelector('#apiNotice');
    return !n || n.hidden;
  });
  check('no unreachable notice — the backend answered cross-origin', noticeHidden);

  const occupied = await page.evaluate(() => {
    const el = document.querySelector('.occ-count');
    return el ? el.textContent.trim() : null;
  });
  check('live occupancy arrived over CORS', occupied !== null && occupied !== '', 'count = ' + occupied);

  /* 4 · the room page and its query-string room id */
  const href = await page.evaluate(() => {
    const btn = document.querySelector('.floor[data-kind="room"] .floor__foot .btn');
    return btn ? btn.dataset.href : '';
  });
  check('lobby builds a relative room link', /^\.\/room\.html\?room=/.test(href), href || 'none');

  const linkedRoom = new URL(href, SITE + '/').searchParams.get('room');
  check('room id travels in the query string', !!linkedRoom, linkedRoom || 'none');

  await page.goto(SITE + '/room.html?room=' + encodeURIComponent(linkedRoom || 'f01'), {
    waitUntil: 'networkidle'
  });
  await page.waitForTimeout(1500);
  const url = page.url();
  check('room link stays on the static origin', url.startsWith(SITE), url.replace(SITE, '<site>'));

  /* The floor lookup happens over CORS before the call starts. */
  const floorMeta = await page.evaluate(() => ({
    level: (document.querySelector('#roomLevel') || {}).textContent || '',
    name: (document.querySelector('#roomName') || {}).textContent || ''
  }));
  check(
    'floor metadata arrived cross-origin',
    floorMeta.level.trim() === '01' && /identity/i.test(floorMeta.name),
    `${floorMeta.level} · ${floorMeta.name}`
  );

  /* Join for real — this is where the socket has to work across origins. */
  await page.click('#joinBtn');
  const joined = await page
    .waitForSelector('#prejoin', { state: 'hidden', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  const prejoinNote = await page.evaluate(() => {
    const el = document.querySelector('#prejoinNote');
    return el ? el.textContent.trim() : '';
  });
  check('room joins from the static origin', joined, joined ? '' : prejoinNote);

  await page.waitForTimeout(2500);
  const conn = await page.evaluate(() => {
    const el = document.querySelector('#connState');
    return el ? el.textContent.trim() : '';
  });
  check('room page is live over the socket', /connected|waiting for others/i.test(conn), conn);

  /* A private code proves the id itself travelled, not just the floor. */
  const priv = await context.newPage();
  await priv.goto(SITE + '/room.html?room=BOARD42', { waitUntil: 'networkidle' });
  await priv.waitForTimeout(1500);
  const privCode = await priv.evaluate(() => {
    const el = document.querySelector('#roomCode');
    return el ? el.textContent.trim() : '';
  });
  check('private room code survives the query string', privCode === 'BOARD42', privCode || 'none');
  await priv.close();

  /* 5 · the control room, from the static origin */
  const admin = await context.newPage();
  const adminErrors = [];
  admin.on('pageerror', (e) => adminErrors.push(String(e)));
  await admin.goto(SITE + '/admin.html', { waitUntil: 'networkidle' });

  const gateVisible = await admin.evaluate(() => {
    const g = document.querySelector('#gate');
    return !!g && !g.hidden;
  });
  check('control room gate is shown', gateVisible);

  await admin.fill('#passwordInput', 'Jmw£V63Gt@9aRO@9(`E,');
  await admin.click('#loginBtn');

  const signedIn = await admin
    .waitForSelector('#dash:not([hidden])', { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  const gateNote = await admin.evaluate(() => {
    const el = document.querySelector('#gateNote');
    return el ? el.textContent.trim() : '';
  });
  check('operator signs in from the static origin', signedIn, signedIn ? '' : gateNote);

  const liveBadge = await admin.evaluate(() => {
    const b = document.querySelector('#liveBadge');
    return b ? b.textContent.trim() : '';
  });
  check('control room is live over the socket', /live/i.test(liveBadge), liveBadge);

  check(
    'page errors: none',
    pageErrors.length === 0 && adminErrors.length === 0,
    pageErrors.concat(adminErrors).join(' | ') || undefined
  );

  await browser.close();
  server.close();
  fs.rmSync(OUT, { recursive: true, force: true });

  console.log('');
  console.log(`${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
