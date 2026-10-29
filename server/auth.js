'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { SESSION_SECRET, SESSION_TTL_MS, OWNER_PASSWORD, OPERATOR_PASSWORD } = require('./config');

const COOKIE = 'roz_session';

/* ------------------------------------------------------------------ */
/* Password hashing                                                    */
/* ------------------------------------------------------------------ */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, digest] = String(stored).split(':');
  if (!salt || !digest) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Credential hashes live on disk so a password changed in the control room is
 * still in force after a restart. If the disk is unavailable we fall back to the
 * passwords from the environment for this process only.
 */
function loadStoredCredentials() {
  const file = require('./config').CREDENTIALS_FILE;
  try {
    const raw = require('fs').readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.owner && parsed.admin) return parsed;
  } catch (_) {
    /* nothing stored yet */
  }
  return null;
}

const stored = loadStoredCredentials();
const CREDENTIALS = {
  owner: (stored && stored.owner) || hashPassword(OWNER_PASSWORD),
  admin: (stored && stored.admin) || hashPassword(OPERATOR_PASSWORD)
};

function persistCredentials() {
  const file = require('./config').CREDENTIALS_FILE;
  try {
    require('fs').writeFileSync(file, JSON.stringify(CREDENTIALS, null, 2));
  } catch (_) {
    /* read-only host — the change still applies until restart */
  }
}

const RANK = { admin: 1, owner: 2 };

/**
 * Resolve a submitted password to a role.
 * The owner password is checked first; if both roles were ever configured to
 * the same string the owner still wins, because it carries the higher rank.
 */
function authenticate(password) {
  if (typeof password !== 'string' || !password) return null;
  if (verifyPassword(password, CREDENTIALS.owner)) return 'owner';
  if (verifyPassword(password, CREDENTIALS.admin)) return 'admin';
  return null;
}

function setPassword(role, password) {
  if (!CREDENTIALS[role]) return false;
  CREDENTIALS[role] = hashPassword(password);
  persistCredentials();
  return true;
}

/** True when the current hashes came from disk rather than the environment. */
const usingStoredCredentials = () => Boolean(stored);

/* ------------------------------------------------------------------ */
/* Signed session tokens                                               */
/* ------------------------------------------------------------------ */

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function createSession(role) {
  return sign({ role, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

/**
 * The session may arrive two ways:
 *
 *   1. the httpOnly cookie, which is what the same-origin deploy uses
 *   2. an `Authorization: Bearer <token>` header, which is what a static
 *      front-end (GitHub Pages) has to use — browsers refuse to send
 *      cookies to a different origin, and third-party cookies are blocked
 *      by default in most browsers now.
 *
 * The cookie wins when both are present.
 */
function getSession(req) {
  const cookies = parseCookies(req);
  let payload = verifyToken(cookies[COOKIE]);

  if (!payload) {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
    if (match) payload = verifyToken(match[1].trim());
  }

  if (!payload || !RANK[payload.role]) return null;
  return payload;
}

function requireSession(req, res, next) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ ok: false, error: 'unauthorised' });
    return;
  }
  req.session = session;
  next();
}

/** Guard for owner-only endpoints. */
function requireOwner(req, res, next) {
  if (!req.session || req.session.role !== 'owner') {
    res.status(403).json({ ok: false, error: 'owner_only' });
    return;
  }
  next();
}

function setSessionCookie(res, role) {
  res.cookie(COOKIE, createSession(role), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

const auditLog = [];

function audit(action, detail, role) {
  const entry = {
    at: new Date().toISOString(),
    action,
    detail: detail || null,
    role: role || null
  };
  auditLog.unshift(entry);
  if (auditLog.length > 500) auditLog.length = 500;
  if (!require('./config').PERSISTENT) return;
  try {
    fs.appendFileSync(require('./config').AUDIT_FILE, JSON.stringify(entry) + '\n');
  } catch (_) {
    /* non fatal */
  }
}

module.exports = {
  COOKIE,
  verifyToken,
  usingStoredCredentials,
  auditLog,
  authenticate,
  setPassword,
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  requireSession,
  requireOwner,
  setSessionCookie,
  clearSessionCookie,
  audit,
  RANK
};
