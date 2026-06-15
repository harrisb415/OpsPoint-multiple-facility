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
// Public base URL of this HQ as the facility reached it — used to point fleet
// manifest/bundle/update-directive URLs back at HQ.
function baseUrl(req) {
  return (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.get('host');
}

// ── Middleware ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'auth required' });
  const u = db.getUser(req.session.userId);
  if (!u) return res.status(401).json({ error: 'auth required' });
  // Server-side teeth for must-change-pw: until the admin sets a new password,
  // the ONLY admin action allowed is the password change itself.
  if (u.must_change_pw && !(req.method === 'POST' && req.path === '/api/me/password'))
    return res.status(403).json({ error: 'password change required', must_change_pw: true });
  req.adminUser = u;
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

// ── HQ admin accounts (central_users; admin-only) ─────────────────────────
app.get('/api/central-users', requireAdmin, (req, res) => {
  res.json({ users: db.listCentralUsers(), me: req.session.userId });
});
app.post('/api/central-users', requireAdmin, (req, res) => {
  const b = req.body || {};
  try {
    const u = db.createCentralUser({ username: b.username, display_name: b.display_name, password: b.password });
    const actor = db.getUser(req.session.userId);
    db.audit({ actor: actor && actor.username, action: 'central_user.create', target: String(u.id), detail: u.username, ip: clientIp(req) });
    res.json({ ok: true, user: u });
  } catch (e) { res.status(400).json({ error: (e && e.message) || 'create failed' }); }
});
app.post('/api/central-users/:id/password', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!db.getUser(id)) return res.status(404).json({ error: 'not found' });
  try {
    db.resetCentralUserPassword(id, (req.body || {}).password);
    const actor = db.getUser(req.session.userId);
    db.audit({ actor: actor && actor.username, action: 'central_user.reset_pw', target: String(id), ip: clientIp(req) });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: (e && e.message) || 'failed' }); }
});
app.delete('/api/central-users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  // Lock-out rails: never delete yourself or the last remaining admin.
  if (id === req.session.userId) return res.status(400).json({ error: 'you cannot delete your own account' });
  if (db.countCentralUsers() <= 1) return res.status(400).json({ error: 'cannot delete the last HQ administrator' });
  const target = db.getUser(id);
  if (!target) return res.status(404).json({ error: 'not found' });
  db.deleteCentralUser(id);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'central_user.delete', target: String(id), detail: target.username, ip: clientIp(req) });
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

app.delete('/api/facilities/:id', requireAdmin, (req, res) => {
  const fac = db.getFacility(req.params.id);
  if (!fac) return res.status(404).json({ error: 'not found' });
  db.deleteFacility(fac.id);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'facility.delete', target: fac.id, detail: fac.name, ip: clientIp(req) });
  res.json({ ok: true });
});

app.get('/api/audit', requireAdmin, (req, res) => {
  res.json({ audit: db.getAudit(200) });
});

// ── Node-facing: check-in (API-key auth, no session) ─────────────────────
app.post('/enroll/checkin', requireFacilityKey, (req, res) => {
  const ip = clientIp(req);
  const b = req.body || {};
  db.touchFacility(req.facility.id, { ip, app_version: String(b.app_version || '') });
  if (b.update_status) db.recordFacilityUpdateStatus(req.facility.id, b.update_status);
  db.evaluateRollout('facility');
  db.audit({ actor: req.facility.name, action: 'facility.checkin', target: req.facility.id, detail: String(b.app_version || ''), ip });
  res.json({
    ok: true,
    server_time: db.nowLocal(),
    facility: { id: req.facility.id, name: req.facility.name },
    target_version: db.getFleetTarget().version,
    update: db.updateDirectiveFor(db.getFacility(req.facility.id), baseUrl(req)),
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
  if (req.body && req.body.update_status) db.recordFacilityUpdateStatus(req.facility.id, req.body.update_status);
  db.evaluateRollout('facility');
  res.json({ ok: true, ...result, target_version: db.getFleetTarget().version, update: db.updateDirectiveFor(db.getFacility(req.facility.id), baseUrl(req)) });
});

// ── Per-facility backup stats (admin) ────────────────────────────────────
app.get('/api/facilities/:id/stats', requireAdmin, (req, res) => {
  const fac = db.getFacility(req.params.id);
  if (!fac) return res.status(404).json({ error: 'not found' });
  res.json({ facility: { id: fac.id, name: fac.name, last_seen_at: fac.last_seen_at }, ...db.facilityTableCounts(fac.id) });
});

// ── Per-facility synced rows for one table (admin) ───────────────────────
// ⚠ Returns the raw backed-up records, which INCLUDE PHI (names, narratives,
// photos). Every access is written to the HQ audit trail.
app.get('/api/facilities/:id/rows', requireAdmin, (req, res) => {
  const fac = db.getFacility(req.params.id);
  if (!fac) return res.status(404).json({ error: 'not found' });
  const table = String(req.query.table || '');
  if (!table) return res.status(400).json({ error: 'table query param required' });
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 500;
  if (limit > 2000) limit = 2000;
  const rows = db.getFacilityRows(fac.id, table, limit);
  db.audit({ actor: req.adminUser && req.adminUser.username, action: 'phi.view', target: fac.id, detail: table + ' ×' + rows.length, ip: clientIp(req) });
  res.json({ table, rows });
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

// ── HQ self-update (Option B updater for the central tier; admin) ─────────
// Respawn this process detached, then exit — used after a successful apply/rollback.
function restartServer() {
  // Under the bootstrap supervisor (run.bat → bootstrap.js), just exit and let
  // bootstrap relaunch + health-check + auto-rollback. Direct launch: self-respawn.
  if (process.env.OPSPOINT_BOOTSTRAP === '1') { setTimeout(() => process.exit(0), 200); return; }
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')],
    { detached: true, stdio: 'ignore', cwd: __dirname, env: process.env });
  child.unref();
  setTimeout(() => process.exit(0), 200);
}
const { createUpdater } = require('./updater');
const updater = createUpdater({
  baseDir: __dirname,
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'central.db'),
  getSetting: db.getSetting,
  audit: db.audit,
  restart: restartServer,
  log: (...a) => console.log('[central-updater]', ...a),
});

app.get('/api/update/status', requireAdmin, (req, res) => res.json(updater.status()));
app.post('/api/update/check', requireAdmin, async (req, res) => {
  try { res.json(await updater.check()); }
  catch (e) { res.status(502).json({ error: (e && e.message) || 'Check failed' }); }
});
app.post('/api/update/apply', requireAdmin, (req, res) => {
  const st = updater.status();
  if (st.progress && st.progress.applying) return res.status(409).json({ error: 'An update is already in progress' });
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'update.apply.start', target: 'central', detail: 'HQ software update started', ip: clientIp(req) });
  updater.apply(actor && actor.username).catch(() => {}); // background; console polls /status
  res.json({ ok: true, started: true });
});
app.get('/api/update/backups', requireAdmin, (req, res) => res.json(updater.backups()));

app.get('/api/update/manifest-url', requireAdmin, (req, res) => {
  res.json({ url: db.getSetting('update_manifest_url', '') });
});
app.post('/api/update/manifest-url', requireAdmin, (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  if (!url) return res.status(400).json({ error: 'URL required' });
  try { new URL(url); } catch (e) { return res.status(400).json({ error: 'Invalid URL' }); }
  db.setSetting('update_manifest_url', url);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'update.manifest_url.set', target: url, ip: clientIp(req) });
  res.json({ ok: true });
});

// Liveness probe for the bootstrap supervisor (unauthenticated).
app.get('/api/health', (req, res) => { let v = '0.0.0'; try { v = require('./package.json').version; } catch (e) {} res.json({ ok: true, version: v }); });
app.post('/api/update/rollback', requireAdmin, async (req, res) => {
  const actor = db.getUser(req.session.userId);
  try { res.json(await updater.rollback(actor && actor.username)); }
  catch (e) { res.status(400).json({ error: (e && e.message) || 'Rollback failed' }); }
});

// ── Release store (Phase 3) — HQ imports a signed release, relays to the fleet ──
const upd = require('./updater');
const RELEASES_DIR = path.join(DATA_DIR, 'releases');

function _host(u) { try { return new URL(u).host; } catch (e) { return ''; } }

// Admin: import a signed release (manifest URL → fetch, verify, download, store).
app.post('/api/releases/import', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const manifestUrl = String(b.manifest_url || '').trim();
  const channel = b.channel === 'central' ? 'central' : 'facility';
  if (!manifestUrl) return res.status(400).json({ error: 'manifest_url required' });
  try {
    const mh = _host(manifestUrl);
    if (!upd.hostAllowed(manifestUrl, [mh])) return res.status(400).json({ error: 'manifest host not allow-listed' });
    const buf = await upd.fetchBuffer(manifestUrl, [mh]);
    let m; try { m = JSON.parse(buf.toString('utf8')); } catch (e) { return res.status(400).json({ error: 'manifest is not valid JSON' }); }
    if (!m.version || !m.url || !m.sha256) return res.status(400).json({ error: 'manifest missing version/url/sha256' });
    if (!upd.verifyManifestSignature(m)) return res.status(400).json({ error: 'manifest signature missing or invalid — refusing to import' });
    const bh = _host(m.url);
    if (!upd.hostAllowed(m.url, [mh, bh])) return res.status(400).json({ error: 'bundle host not allow-listed' });
    const dir = path.join(RELEASES_DIR, channel); fs.mkdirSync(dir, { recursive: true });
    const filename = channel + '-' + m.version + '.zip';
    const dest = path.join(dir, filename);
    await upd.downloadToFile(m.url, dest, [mh, bh]);
    if (m.size && fs.statSync(dest).size !== m.size) { fs.rmSync(dest, { force: true }); return res.status(400).json({ error: 'downloaded size does not match manifest' }); }
    const digest = await upd.sha256File(dest);
    if (digest.toLowerCase() !== String(m.sha256).toLowerCase()) { fs.rmSync(dest, { force: true }); return res.status(400).json({ error: 'sha256 mismatch — refusing to store' }); }
    const rel = db.recordRelease({
      channel, version: m.version, filename, size: m.size || fs.statSync(dest).size, sha256: String(m.sha256).toLowerCase(),
      signature: m.signature, sig_alg: m.sig_alg || 'ed25519', min_node: m.min_node, min_from: m.min_from,
      changelog: m.changelog, released: m.released, status: 'published',
    });
    const actor = db.getUser(req.session.userId);
    db.audit({ actor: actor && actor.username, action: 'release.import', target: channel + '/' + m.version, detail: filename, ip: clientIp(req) });
    res.json({ ok: true, release: rel });
  } catch (e) { res.status(502).json({ error: (e && e.message) || 'import failed' }); }
});

app.get('/api/releases/saved-urls', requireAdmin, (req, res) => {
  res.json({
    facility: db.getSetting('releases_facility_manifest_url', ''),
    central:  db.getSetting('releases_central_manifest_url',  ''),
  });
});
app.post('/api/releases/saved-urls', requireAdmin, (req, res) => {
  const { channel, url } = req.body || {};
  const u = String(url || '').trim();
  if (channel === 'facility')      db.setSetting('releases_facility_manifest_url', u);
  else if (channel === 'central')  db.setSetting('releases_central_manifest_url',  u);
  else return res.status(400).json({ error: 'channel required (facility|central)' });
  res.json({ ok: true });
});

app.get('/api/releases', requireAdmin, (req, res) => res.json({ releases: db.listReleases() }));
app.post('/api/releases/:channel/:version/status', requireAdmin, (req, res) => {
  if (!db.getRelease(req.params.channel, req.params.version)) return res.status(404).json({ error: 'not found' });
  const status = (req.body && req.body.status) === 'yanked' ? 'yanked' : 'published';
  db.setReleaseStatus(req.params.channel, req.params.version, status);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'release.status', target: req.params.channel + '/' + req.params.version, detail: status, ip: clientIp(req) });
  res.json({ ok: true, status });
});

// Facility-facing: latest published facility release as a manifest, bundle URL → HQ.
app.get('/fleet/manifest', requireFacilityKey, (req, res) => {
  const rel = db.manifestReleaseFor(db.getFacility(req.facility.id)); // rollout-gated
  if (!rel) return res.status(404).json({ error: 'no update available for this facility' });
  db.touchFacility(req.facility.id, { ip: clientIp(req), app_version: req.facility.app_version || '' });
  const base = baseUrl(req);
  res.json({
    version: rel.version, released: rel.released, min_node: rel.min_node, min_from: rel.min_from,
    url: base + '/fleet/bundle/' + rel.version, sha256: rel.sha256, size: rel.size,
    sig_alg: rel.sig_alg, signature: rel.signature, changelog: rel.changelog,
  });
});

// Facility-facing: stream the stored bundle (API-key auth).
app.get('/fleet/bundle/:version', requireFacilityKey, (req, res) => {
  const rel = db.getRelease('facility', req.params.version);
  if (!rel || rel.status !== 'published') return res.status(404).json({ error: 'not found' });
  const file = path.join(RELEASES_DIR, 'facility', rel.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'bundle missing on disk' });
  db.audit({ actor: req.facility.name, action: 'release.download', target: 'facility/' + rel.version, ip: clientIp(req) });
  res.setHeader('content-type', 'application/zip');
  res.setHeader('content-length', String(fs.statSync(file).size));
  fs.createReadStream(file).pipe(res);
});

// ── Rollout orchestration (Phase 5; admin) ───────────────────────────────
app.get('/api/rollout', requireAdmin, (req, res) => {
  res.json({ rollout: db.getRollout('facility'), facilities: db.listFacilities(), releases: db.listReleases('facility') });
});
app.post('/api/rollout', requireAdmin, (req, res) => {
  const b = req.body || {};
  const version = String(b.version || '').trim();
  if (!version) return res.status(400).json({ error: 'version required' });
  const rel = db.getRelease('facility', version);
  if (!rel || rel.status !== 'published') return res.status(400).json({ error: 'no published facility release for ' + version });
  const ro = db.startRollout('facility', version, Array.isArray(b.canary_ids) ? b.canary_ids : [], b.notes);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'rollout.start', target: 'facility/' + version, detail: ro.state + (ro.canary_ids.length ? ' canary=' + ro.canary_ids.length : ''), ip: clientIp(req) });
  res.json({ ok: true, rollout: ro });
});
app.post('/api/rollout/:action', requireAdmin, (req, res) => {
  const ro = db.getRollout('facility');
  if (!ro) return res.status(404).json({ error: 'no active rollout' });
  let next;
  if (req.params.action === 'pause') next = 'paused';
  else if (req.params.action === 'resume') next = ro.canary_ids.length ? 'canary' : 'active';
  else if (req.params.action === 'advance') next = 'active';
  else return res.status(400).json({ error: 'unknown action' });
  const updated = db.setRolloutState('facility', next);
  const actor = db.getUser(req.session.userId);
  db.audit({ actor: actor && actor.username, action: 'rollout.' + req.params.action, target: 'facility/' + ro.version, detail: next, ip: clientIp(req) });
  res.json({ ok: true, rollout: updated });
});

// ── Console (Vite-built React SPA in client/dist) ────────────────────────
// The console is a React SPA built by `cd client && npm run build`
// (run.bat / run.sh do this automatically on first launch).
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');
const INDEX_HTML = path.join(CLIENT_DIST, 'index.html');
app.use(express.static(CLIENT_DIST));
app.get('*', (req, res) => {
  if (!fs.existsSync(INDEX_HTML))
    return res.status(503).send('Console not built — run "npm run build" in central/client.');
  res.sendFile(INDEX_HTML);
});

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
