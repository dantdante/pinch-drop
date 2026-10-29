#!/usr/bin/env node
/* ==========================================================
   Rise of Zoom — static site build
   ----------------------------------------------------------
   Produces a folder of plain files that GitHub Pages can serve:
   the lobby, the room and the control room, all talking to a
   signalling server that lives somewhere else.

       node scripts/build-pages.js --api-base https://rise-of-zoom.onrender.com
       node scripts/build-pages.js --api-base https://… --out dist

   What it does:
     1. copies public/ into the output folder
     2. rewrites every absolute path ("/css/base.css") to a
        relative one ("./css/base.css") so the site works from
        a project sub-path such as /rise-of-zoom/
     3. writes config.js with the API base and static: true
     4. drops a .nojekyll marker and a 404.html fallback
   ========================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const API_BASE = (arg('api-base', process.env.SIGNALLING_URL) || '').replace(/\/$/, '');
const OUT = path.resolve(ROOT, arg('out', '_site'));

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/* Rewrite root-absolute URLs to relative ones so the site can live
   under any sub-path. Only touches attributes, never inline scripts. */
function relativise(html) {
  return html
    .replace(/(src|href)="\/(?!\/)/g, '$1="./')
    /* "/admin" is a server route; on a static host it is a file. */
    .replace(/(href)="\.\/admin"/g, '$1="./admin.html"');
}

/* ------------------------------------------------------------------ */
/* Build                                                              */
/* ------------------------------------------------------------------ */

console.log('→ building the static site');
console.log(`   source : ${PUBLIC_DIR}`);
console.log(`   output : ${OUT}`);
console.log(`   apiBase: ${API_BASE || '(same origin — not set)'}`);

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(PUBLIC_DIR, OUT);

/* 1 · HTML — relative paths */
for (const file of ['index.html', 'room.html', 'admin.html']) {
  const p = path.join(OUT, file);
  if (!fs.existsSync(p)) continue;
  fs.writeFileSync(p, relativise(fs.readFileSync(p, 'utf8')));
  console.log(`   rewrote ${file}`);
}

/* 2 · config.js — the API base and the static flag */
const configPath = path.join(OUT, 'config.js');
let config = fs.readFileSync(configPath, 'utf8');
config = config.replace(/apiBase:\s*'[^']*'/, `apiBase: '${API_BASE}'`);
/* Anchored to the start of a line so the explanatory comment above the
   key is never touched. */
config = config.replace(/^(\s*)static:\s*(true|false)/m, '$1static: true');
fs.writeFileSync(configPath, config);
console.log('   rewrote config.js');

/* 3 · housekeeping */
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const indexHtml = path.join(OUT, 'index.html');
if (fs.existsSync(indexHtml)) {
  fs.copyFileSync(indexHtml, path.join(OUT, '404.html'));
}

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else files.push(path.relative(OUT, p));
  }
})(OUT);

console.log('');
console.log(`✓ ${files.length} files in ${path.relative(ROOT, OUT)}`);
if (!API_BASE) {
  console.log('');
  console.log('  ! No API base was set, so the static site will look for the');
  console.log('    signalling server on its own origin and show the');
  console.log('    "server unreachable" notice.');
}
