'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
// Where floors / settings / blocklist / audit / credentials are written.
// Override with DATA_DIR (absolute path, or relative to the project root).
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(ROOT, process.env.DATA_DIR)
  : path.join(ROOT, 'data');

/**
 * Some hosts (read-only containers, serverless) refuse disk writes. We probe once
 * and fall back to a purely in-memory store so the app still runs.
 */
let PERSISTENT = true;
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (_) {
  PERSISTENT = false;
}

/**
 * Floors of the tower. Each floor is a permanently addressable video-call room.
 * `id` is both the slug used in /room/:id and the room key used for signalling.
 */
const DEFAULT_FLOORS = [
  {
    id: 'lobby',
    level: 'G',
    name: 'Lobby',
    nameTr: 'Lobi',
    tagline: 'Every call starts on the ground floor.',
    taglineTr: 'Her görüşme zemin kattan başlar.',
    body: 'The lift is here, the doors are open, and the whole tower is one signal away. Choose a floor and step inside.',
    bodyTr: 'Asansör burada, kapılar açık, kule tek bir sinyal uzakta. Bir kat seçin ve içeri girin.',
    accent: 'brass',
    room: false,
    enabled: true
  },
  {
    id: 'f01',
    level: '01',
    name: 'Identity',
    nameTr: 'Kimlik',
    tagline: 'A room becomes a place.',
    taglineTr: 'Bir oda bir mekâna dönüşür.',
    body: 'Where names become marks and faces become the mark. The first floor is for introductions.',
    bodyTr: 'İsimlerin markaya, yüzlerin işarete dönüştüğü yer. İlk kat tanışmalar içindir.',
    accent: 'brass',
    room: true,
    enabled: true
  },
  {
    id: 'f02',
    level: '02',
    name: 'Design',
    nameTr: 'Tasarım',
    tagline: 'Then it learns to speak on paper.',
    taglineTr: 'Sonra kâğıtta konuşmayı öğrenir.',
    body: 'Every surface your team touches speaks with one voice, recognised before a single name is read.',
    bodyTr: 'Ekibinizin dokunduğu her yüzey tek bir sesle konuşur, adı okunmadan tanınır.',
    accent: 'amber',
    room: true,
    enabled: true
  },
  {
    id: 'f03',
    level: '03',
    name: 'Motion',
    nameTr: 'Hareket',
    tagline: 'Then it learns to move.',
    taglineTr: 'Sonra hareket etmeyi öğrenir.',
    body: 'Timings, transitions, the camera that pans instead of cuts. Everything here has a rhythm.',
    bodyTr: 'Zamanlamalar, geçişler, kesme yerine kayan kamera. Buradaki her şeyin bir ritmi var.',
    accent: 'amber',
    room: true,
    enabled: true
  },
  {
    id: 'f04',
    level: '04',
    name: 'Broadcast',
    nameTr: 'Yayın',
    tagline: 'Then the whole office sees it.',
    taglineTr: 'Sonra bütün ofis görür.',
    body: 'The floor where the meeting stops being a meeting and becomes a transmission.',
    bodyTr: 'Toplantının toplantı olmaktan çıkıp bir yayına dönüştüğü kat.',
    accent: 'copper',
    room: true,
    enabled: true
  },
  {
    id: 'f05',
    level: '05',
    name: 'Systems',
    nameTr: 'Sistemler',
    tagline: 'Then it learns to think.',
    taglineTr: 'Sonra düşünmeyi öğrenir.',
    body: 'Dashboards, automations and the quiet machinery that keeps everyone else on time.',
    bodyTr: 'Panolar, otomasyonlar ve herkesi zamanında tutan sessiz makineler.',
    accent: 'copper',
    room: true,
    enabled: true
  },
  {
    id: 'roof',
    level: 'R',
    name: 'Boardroom',
    nameTr: 'Yönetim Kurulu',
    tagline: 'Small on the outside. Endless inside.',
    taglineTr: 'Dışarıdan küçük. İçi sonsuz.',
    body: 'The top floor. Longer tables, longer conversations, the same connection underneath.',
    bodyTr: 'En üst kat. Daha uzun masalar, daha uzun konuşmalar, altta aynı bağlantı.',
    accent: 'chrome',
    room: true,
    enabled: true
  }
];

/**
 * Admin credentials.
 * The owner password outranks the operator password. Both may be overridden
 * through the environment so they never have to live in source control.
 */
const OWNER_PASSWORD = process.env.ADMIN_OWNER_PASSWORD || '6xtXBG78|"o_iXDZY]3a';
const OPERATOR_PASSWORD = process.env.ADMIN_PASSWORD || 'Jmw£V63Gt@9aRO@9(`E,';

const SESSION_SECRET_FILE = path.join(DATA_DIR, 'session-secret');

let memorySecret = null;

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    const existing = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch (_) {
    /* first boot */
  }
  const secret = require('crypto').randomBytes(48).toString('hex');
  if (PERSISTENT) {
    try {
      fs.writeFileSync(SESSION_SECRET_FILE, secret, { mode: 0o600 });
    } catch (_) {
      PERSISTENT = false;
    }
  }
  // Without a disk we still need a stable secret for the life of the process.
  memorySecret = memorySecret || secret;
  return memorySecret;
}

/**
 * ICE servers handed to the browser. STUN alone works for most home networks but
 * fails behind symmetric NAT / strict corporate firewalls, so a TURN relay can be
 * supplied through the environment and is used automatically when present.
 */
function iceServers() {
  const list = [];
  const stun = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  stun.forEach((urls) => list.push({ urls }));

  const turnUrls = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (turnUrls.length) {
    const entry = { urls: turnUrls, username: process.env.TURN_USERNAME || '' };
    if (process.env.TURN_CREDENTIAL) entry.credential = process.env.TURN_CREDENTIAL;
    list.push(entry);
  }
  return list;
}

/**
 * Origins allowed to talk to this server from a browser.
 *
 * The lobby, the rooms and the control room may be served as plain files
 * from GitHub Pages while the signalling server runs somewhere else, so the
 * API has to answer cross-origin requests. By default every origin is
 * allowed (the API carries no cookies — the admin token travels in the
 * Authorization header). Set ALLOWED_ORIGINS to a comma separated list to
 * lock it down, e.g.
 *
 *   ALLOWED_ORIGINS=https://dantdante.github.io,https://tower.up.railway.app
 */
function allowedOrigins() {
  const list = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list;
}

/** True when `origin` may talk to this server. */
function originAllowed(origin) {
  if (!origin) return false;
  const list = allowedOrigins();
  if (!list.length) return true; // open by default
  if (list.includes('*')) return true;
  return list.includes(origin);
}

module.exports = {
  ROOT,
  DATA_DIR,
  PERSISTENT,
  iceServers,
  allowedOrigins,
  originAllowed,
  DEFAULT_FLOORS,
  OWNER_PASSWORD,
  OPERATOR_PASSWORD,
  SESSION_SECRET: loadSecret(),
  PORT: Number(process.env.PORT || 4321),
  HOST: process.env.HOST || '0.0.0.0',
  MAX_PARTICIPANTS: Number(process.env.MAX_PARTICIPANTS || 12),
  SESSION_TTL_MS: 1000 * 60 * 60 * 8,
  FLOORS_FILE: path.join(DATA_DIR, 'floors.json'),
  AUDIT_FILE: path.join(DATA_DIR, 'audit.log'),
  BLOCKLIST_FILE: path.join(DATA_DIR, 'blocklist.json'),
  SETTINGS_FILE: path.join(DATA_DIR, 'settings.json'),
  CREDENTIALS_FILE: path.join(DATA_DIR, 'credentials.json')
};
