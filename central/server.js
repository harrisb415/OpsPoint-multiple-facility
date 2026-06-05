/**
 * central/server.js — OpsPoint Central / HQ server (Phase 0).
 *
 * Responsibilities (Phase 0):
 *   • Org-admin login / session (PBKDF2, mirrors the facility app posture).
 *   • Facility registry CRUD via a small JSON API + a minimal web console.
 *   • Node-facing  POST /enroll/checkin  authenticated by per-facility API key.
 *
 * Facilities make OUTBOUND connections only; this server exposes one ingress.
 * TLS: drop data/cert.pem + data/key.pem to auto-switch to HTTPS. In production
 * the API key travels over the network, so TLS (or a VPN) is mandatory.
 */
'use strict';
const express = require('express');
const session = require('express-session');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const https   = require('https');
const db      = require('./db');

const PORT     = parseInt(process.env.PORT || '4000', 10);
const DATA_DIR = process.env.CENTRAL_DATA || path.join(__dirname, 'data');

db.init(path.join(DATA_DIR, 'central.db'));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '25mb' }));

app.use(session({
  name: 'opscentral.sid',
  secret: db.getSetting('session_secret') || 'insecure-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: fs.existsSync(path.join(DATA_DIR, 'cert.pem')),
    maxAge: 1000 * 60 * 60 * 8, // 8h
  },
}));

// ── CSRF: validate Origin host on state-changing requests ────────────────
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host'))
        return res.status(403).json({ error: 'bad origin' });
    } catch (e) {
      return res.status(403).json({ error: 'bad origin' });
    }
  }
  next();
});

// ── Tiny in-memory login rate limiter (10 / 15 min / IP) ─────────────────
const loginHits = new Map();
function loginLimited(ip) {
  const now = Date.now(), win = 15 * 60 * 1000;
  const e = loginHits.get(ip) || { n: 0, t: now };
  if (now - e.t > win) { e.n = 0; e.t = now; }
  e.n += 1; loginHits.set(ip, e);
  return e.n > 10;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

// ── Middleware ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'auth required' });
  next();
}
function requireFacilityKey(req, res, next) {
  const key = req.get('x-facility-key') || '';
  const fac = key && db.facilityByKey(key);
  if (!fac) return res.status(401).json({ error: 'invalid facility key' });
  if (fac.status !== 'active') return res.status(403).json({ error: 'facility disabled' });
  req.facility = fac;
  next();
}

// ── Auth routes ──────────────────────────────────────────────────────────
app.post('/login', (req, res) => {
  const ip = clientIp(req);
  if (loginLimited(ip)) return res.status(429).json({ error: 'too many attempts, try later' });
  const { username, password } = req.body || {};
  const u = db.authUser(username, password);
  if (!u) {
    db.audit({ action: 'login.fail', target: String(username || ''), ip });
    return res.status(401).json({ error: 'invalid credentials' });
  }
  req.session.userId = u.id;
  db.audit({ actor: u.username, action: 'login.ok', ip });
  res.json({ ok: true, user: u });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'auth required' });
  const u = db.getUser(req.session.userId);
  if (!u) return res.status(401).json({ error: 'auth required' });
  res.json(u);
});

app.post('/api/me/password', requireAdmin, (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 10)
    return res.status(400).json({ error: 'password must be at least 10 characters' });
  db.setUserPassword(req.session.userId, String(password));
  const u = db.getUser(req.session.userId);
  db.audit({ actor: u.username, action: 'password.change', ip: clientIp(req) });
  res.json({ ok: true });
});

// ── Facility registry (admin) ────────────────────────────────────────────
app.get('/api/facilities', requireAdmin, (req, res) => {
  res.json({ facilities: db.listFacilities() });
});

app.post('/api/facilities', requireAdmin, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const created = db.createFacility(name);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'facility.create', target: created.id, detail: name, ip: clientIp(req) });
  // apiKey returned ONCE — never retrievable again.
  res.json({ ok: true, facility: { id: created.id, name: created.name }, apiKey: created.apiKey });
});

app.post('/api/facilities/:id/rotate-key', requireAdmin, (req, res) => {
  const fac = db.getFacility(req.params.id);
  if (!fac) return res.status(404).json({ error: 'not found' });
  const apiKey = db.rotateFacilityKey(fac.id);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'facility.rotate_key', target: fac.id, ip: clientIp(req) });
  res.json({ ok: true, apiKey });
});

app.post('/api/facilities/:id/status', requireAdmin, (req, res) => {
  const fac = db.getFacility(req.params.id);
  if (!fac) return res.status(404).json({ error: 'not found' });
  const status = (req.body && req.body.status) === 'disabled' ? 'disabled' : 'active';
  db.setFacilityStatus(fac.id, status);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'facility.status', target: fac.id, detail: status, ip: clientIp(req) });
  res.json({ ok: true, status });
});

app.get('/api/audit', requireAdmin, (req, res) => {
  res.json({ audit: db.getAudit(200) });
});

// ── Node-facing: check-in (API-key auth, no session) ─────────────────────
app.post('/enroll/checkin', requireFacilityKey, (req, res) => {
  const ip = clientIp(req);
  const appVersion = String((req.body && req.body.app_version) || '');
  db.touchFacility(req.facility.id, { ip, app_version: appVersion });
  db.audit({ actor: req.facility.name, action: 'facility.checkin', target: req.facility.id, detail: appVersion, ip });
  res.json({
    ok: true,
    server_time: db.nowLocal(),
    facility: { id: req.facility.id, name: req.facility.name },
    target_version: db.getFleetTarget().version,
  });
});

// ── Node-facing: sync ingest (API-key auth, no session) ──────────────────
app.post('/sync/ingest', requireFacilityKey, (req, res) => {
  const ip = clientIp(req);
  const rows = (req.body && req.body.rows) || [];
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows must be an array' });
  let result;
  try { result = db.ingestRows(req.facility.id, rows); }
  catch (e) { return res.status(500).json({ error: 'ingest failed: ' + ((e && e.message) || 'error') }); }
  db.touchFacility(req.facility.id, { ip, app_version: String((req.body && req.body.app_version) || req.facility.app_version || '') });
  res.json({ ok: true, ...result, target_version: db.getFleetTarget().version });
});

// ── Per-facility backup stats (admin) ────────────────────────────────────
app.get('/api/facilities/:id/stats', requireAdmin, (req, res) => {
  const fac = db.getFacility(req.params.id);
  if (!fac) return res.status(404).json({ error: 'not found' });
  res.json({ facility: { id: fac.id, name: fac.name, last_seen_at: fac.last_seen_at }, ...db.facilityTableCounts(fac.id) });
});

// ── Per-facility synced rows for one table (admin; feeds Phase 2 reporting) ─
app.get('/api/facilities/:id/rows', requireAdmin, (req, res) => {
  const fac = db.getFacility(req.params.id);
  if (!fac) return res.status(404).json({ error: 'not found' });
  const table = String(req.query.table || '');
  if (!table) return res.status(400).json({ error: 'table query param required' });
  res.json({ table, rows: db.getFacilityRows(fac.id, table) });
});

// ── Cross-facility reporting (admin; aggregate counts only, no PHI) ───────
app.get('/api/report/overview', requireAdmin, (req, res) => {
  res.json(db.reportOverview());
});

// ── Fleet update coordination (Phase 3; admin) ───────────────────────────
app.get('/api/fleet/target', requireAdmin, (req, res) => res.json(db.getFleetTarget()));
app.post('/api/fleet/target', requireAdmin, (req, res) => {
  const b = req.body || {};
  const t = db.setFleetTarget(b.version, b.notes);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'fleet.set_target', detail: t.version, ip: clientIp(req) });
  res.json({ ok: true, ...t });
});

// ── Managed users (Phase 2b) — admin CRUD ────────────────────────────────
app.get('/api/managed-users', requireAdmin, (req, res) => {
  res.json({ users: db.listManagedUsers(), facilities: db.listFacilities().map(f => ({ id: f.id, name: f.name })) });
});
app.post('/api/managed-users', requireAdmin, (req, res) => {
  const b = req.body || {};
  try {
    const u = db.createManagedUser({ username: b.username, display_name: b.display_name, role: b.role, password: b.password, facilities: b.facilities });
    const actor = db.getUser(req.session.userId);
    db.audit({ actor: actor && actor.username, action: 'managed_user.create', target: u.id, detail: u.username, ip: clientIp(req) });
    res.json({ ok: true, user: u });
  } catch (e) { res.status(400).json({ error: (e && e.message) || 'create failed' }); }
});
app.put('/api/managed-users/:id', requireAdmin, (req, res) => {
  try { res.json({ ok: true, user: db.updateManagedUser(req.params.id, req.body || {}) }); }
  catch (e) { res.status(400).json({ error: (e && e.message) || 'update failed' }); }
});
app.post('/api/managed-users/:id/password', requireAdmin, (req, res) => {
  try { db.setManagedUserPassword(req.params.id, (req.body || {}).password); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: (e && e.message) || 'failed' }); }
});
app.put('/api/managed-users/:id/facilities', requireAdmin, (req, res) => {
  try { res.json({ ok: true, user: db.setManagedUserFacilities(req.params.id, (req.body || {}).facilities || []) }); }
  catch (e) { res.status(400).json({ error: (e && e.message) || 'failed' }); }
});
app.delete('/api/managed-users/:id', requireAdmin, (req, res) => {
  db.deleteManagedUser(req.params.id);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'managed_user.delete', target: req.params.id, ip: clientIp(req) });
  res.json({ ok: true });
});

// ── Node-facing: pull this facility's managed users (API-key auth) ────────
app.get('/sync/users', requireFacilityKey, (req, res) => {
  res.json({ ok: true, users: db.getManagedUsersForFacility(req.facility.id) });
});

// ── Console (static SPA-ish single page) ─────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Boot (HTTP, or HTTPS if certs present) ───────────────────────────────
const certPath = path.join(DATA_DIR, 'cert.pem');
const keyPath  = path.join(DATA_DIR, 'key.pem');
let server, scheme;
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  server = https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app);
  scheme = 'https';
} else {
  server = http.createServer(app);
  scheme = 'http';
  console.log('  ⚠  No TLS certs in', DATA_DIR, '— running plain HTTP (dev only).');
}
server.listen(PORT, () => {
  console.log(`  OpsPoint Central listening on ${scheme}://localhost:${PORT}`);
});
