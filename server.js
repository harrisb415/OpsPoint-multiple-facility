/**
 * OpsPoint — Server v2.4.0
 * SQLite + HTTPS + Session Auth + Role-based access
 */
'use strict';
const http    = require('http');
const https   = require('https');
const express = require('express');
const session = require('express-session');
const WebSocket = require('ws');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const db      = require('./db');
const backup  = require('./backup');

// ── Modular foundation (Part A refactor — see server/ARCHITECTURE.md) ──────
// Pure, low-coupling pieces extracted from this file. Behaviour is identical;
// these are the seams the cloud migration (config, real-time backplane) needs.
const config = require('./server/config');
const { hashPw, verifyPw, validatePw } = require('./server/lib/crypto');
const { nowLocal, timeToMins }         = require('./server/lib/time');
const { getLocalIP }                   = require('./server/lib/net');
const { sanitizeText: _sanitizeText, validTime: _validTime } = require('./server/lib/text');
const { broadcast, setWss }            = require('./server/realtime/broadcast');
const { securityHeaders, cors }        = require('./server/middleware/security');
const { csrfCheck, originHost }        = require('./server/middleware/csrf');
const { audit, auditRead }             = require('./server/middleware/audit');
const { requireUnlocked, requireConsent } = require('./server/middleware/recordLock');
const { userPerms: _userPerms, requireAuth, requirePermission, requireAnyPermission } = require('./server/middleware/auth');
const { idleSessionCheck, requireForceChangePw } = require('./server/middleware/session');
const { loginRateCheck, loginRateClear, apiRateCheck } = require('./server/middleware/rateLimit');

const app  = express();
app.disable('x-powered-by');
const PORT = config.PORT;
const BASE = config.BASE;

const DATA           = config.DATA_DIR;
const DB_PATH        = config.DB_PATH;
const LEGACY_DB_PATH = config.LEGACY_DB_PATH;

// One-time rename: data/shift.db → data/opspoint.db (legacy DB filename)
try {
  if (fs.existsSync(LEGACY_DB_PATH) && !fs.existsSync(DB_PATH)) {
    fs.renameSync(LEGACY_DB_PATH, DB_PATH);
    const shm = LEGACY_DB_PATH + '-shm', wal = LEGACY_DB_PATH + '-wal';
    if (fs.existsSync(shm)) fs.renameSync(shm, DB_PATH + '-shm');
    if (fs.existsSync(wal)) fs.renameSync(wal, DB_PATH + '-wal');
    console.log('  Migrated legacy DB: shift.db → opspoint.db');
  }
} catch (e) { console.warn('  DB rename failed:', e.message); }
// React SPA — always served
const REACT_DIST = config.REACT_DIST;
const serveSPA = (res) => res.sendFile(path.join(REACT_DIST, 'index.html'));

fs.mkdirSync(DATA,             { recursive:true });
fs.mkdirSync(config.PHOTOS_DIR,{ recursive:true });

// Password helpers (hashPw/verifyPw/validatePw), time helpers (nowLocal/
// timeToMins), getLocalIP, and broadcast now live in ./server/lib +
// ./server/realtime and are required at the top of this file.
let wss;  // the live WebSocket.Server; handed to the broadcast module via setWss()

// Restart the server. Under the bootstrap supervisor (run.bat → bootstrap.js,
// sets OPSPOINT_BOOTSTRAP=1) we simply exit and let bootstrap relaunch +
// health-check + auto-rollback. Launched directly (dev), self-respawn detached.
function restartServer() {
  if (process.env.OPSPOINT_BOOTSTRAP === '1') { setTimeout(() => process.exit(0), 200); return; }
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(BASE, 'server.js')], { detached: true, stdio: 'ignore', cwd: BASE });
  child.unref();
  process.exit(0);
}

// ── Middleware ───────────────────────────────────────────────────
// Request guards (securityHeaders, cors, csrfCheck, audit, requireAuth,
// requirePermission(+Any), idleSessionCheck, requireForceChangePw, login
// rate-limit) now live in ./server/middleware and are required up top.

app.use(securityHeaders);
app.use(express.json({ limit: config.JSON_LIMIT })); // large limit needed for base64 photo uploads
app.use(cors);

const SESSION_SECRET = config.loadSessionSecret();

// Force-change middleware applied after session
var _sessionMiddleware = null;
function buildSession(secure) {
  return session({
    secret:SESSION_SECRET, resave:false, saveUninitialized:false,
    cookie:{ secure:!!secure, httpOnly:true, sameSite:'lax', maxAge:config.SESSION_MAX_AGE_MS }
  });
}
_sessionMiddleware = buildSession(false);
app.use((req,res,next) => _sessionMiddleware(req,res,next));

app.use(idleSessionCheck);  // HIPAA idle timeout — server/middleware/session.js

// Lightweight passive endpoint — client can poll this to check session validity
// without bumping last_activity. (POST /api/heartbeat bumps activity.)
app.get('/api/heartbeat', (req,res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ok:false});
  res.json({ok:true, idleMins:parseInt(db.getSetting('session_idle_mins',config.SESSION_IDLE_DEFAULT_MINS))||config.SESSION_IDLE_DEFAULT_MINS});
});

app.use(requireForceChangePw);  // forced-password-change gate — server/middleware/session.js

// _validTime / _sanitizeText now live in ./server/lib/text (required up top).
// _isReportClosed now lives in server/modules/reports (repository.isReportClosed).

// _countAdmins now lives in server/modules/users (repository.countAdmins).

// audit / csrfCheck / loginRateCheck / loginRateClear now live in
// ./server/middleware (audit.js, csrf.js, rateLimit.js) — required up top.

// ── Auth: login / logout / me / change-password (modular: server/modules/auth) ─────────
require('./server/modules/auth/routes').register(app, { serveSPA });


// ── Page routes (React SPA handles client-side routing) ──────────
app.get('/', requireAuth, (req,res)=> serveSPA(res));
app.get('/facility', requireAuth, (req,res)=> res.redirect('/admin'));
app.get('/admin', requireAuth, requirePermission('admin.users'), (req,res)=> serveSPA(res));
app.get('/mobile', requireAuth, requirePermission('mobile.access'), (req,res)=> serveSPA(res));
app.get('/about', requireAuth, (req,res)=> serveSPA(res));
app.use('/static/icons', express.static(path.join(BASE,'static','icons'))); // public (favicon on login page)
app.use('/static', requireAuth, express.static(path.join(BASE,'static')));
app.get('/sw.js',(req,res)=>{
  // Unregisters any legacy service worker from the vanilla build
  res.setHeader('Content-Type','application/javascript');
  res.setHeader('Service-Worker-Allowed','/');
  res.send('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.map(n=>caches.delete(n)))).then(()=>self.registration.unregister()));});');
});

// ── React SPA static assets (served early — won't conflict with API routes) ──
app.use(express.static(REACT_DIST));

// ── Users + permission profiles + groups (modular: server/modules/users) ─────────
require('./server/modules/users/routes').register(app);

// _validImageMagicBytes now lives in server/modules/reports/service.js
// (clients module has its own copy). Other photo routes inline their own check.

// API rate limiting (apiRateCheck) now lives in server/middleware/rateLimit.js

// ── Data API + log/report deletion + UA photo (modular: server/modules/reports) ─────────
require('./server/modules/reports/routes').register(app);

// ── Facility settings + rooms + photos + EHR config (modular: server/modules/facility) ─────────
require('./server/modules/facility/routes').register(app);

// ── Clients: add / update / profile-view (modular: server/modules/clients) ─────────
require('./server/modules/clients/routes').register(app);



// ── Staff Directory (modular: server/modules/staff) ─────────
require('./server/modules/staff/routes').register(app);

// ── Chores (modular: server/modules/chores) ─────────
require('./server/modules/chores/routes').register(app);

// ── Group Sessions (modular: server/modules/groups) ─────────
require('./server/modules/groups/routes').register(app);

// ── Weekend Passes (modular: server/modules/passes) ─────────
require('./server/modules/passes/routes').register(app);


// ── UA Requests + Draws (modular: server/modules/ua) ─────────
require('./server/modules/ua/routes').register(app);

// ── Broadcasts (modular: server/modules/broadcasts) ─────────
require('./server/modules/broadcasts/routes').register(app);

// ── Mail Log (modular: server/modules/mail) ─────────
require('./server/modules/mail/routes').register(app);

// ── Violations (modular: server/modules/violations) ─────────
require('./server/modules/violations/routes').register(app);

// ── Admin: server restart + audit log (modular: server/modules/admin) ─────────
require('./server/modules/admin/routes').register(app, { restartServer });

// ════════════════════════════════════════════════════════════════════
// EHR EXPANSION — clinical records, immutability, consent, idle session
// ════════════════════════════════════════════════════════════════════

// Helper: audit PHI read events. action='record.read' per HIPAA Security Rule.
// requireUnlocked / requireConsent now live in server/middleware/recordLock.js.


// ── Clinical: UA records / med log / milestones / incidents (modular: server/modules/clinical) ─────────
require('./server/modules/clinical/routes').register(app);

// ── Auto-update (Option B — manifest + signed bundle) ─────────────
const { createUpdater } = require('./updater');
const updater = createUpdater({
  baseDir: BASE, dataDir: DATA, dbPath: DB_PATH, db,
  broadcast, restart: restartServer, log: (...a) => console.log('[updater]', ...a),
  // When the manifest/bundle is served by our HQ relay, authenticate with the
  // facility API key so HQ can serve on-prem (facilities never touch the internet).
  authFor: (urlStr) => {
    try {
      const cu = db.getSetting('central_url', '') || '';
      const key = db.getSetting('central_api_key', '') || '';
      if (cu && key && new URL(urlStr).host === new URL(cu).host) return { 'x-facility-key': key };
    } catch (e) {}
    return {};
  },
  insecureFor: (urlStr) => {
    try {
      const cu = db.getSetting('central_url', '') || '';
      if (cu && db.getSetting('central_insecure_tls', false) && new URL(urlStr).host === new URL(cu).host) return true;
    } catch (e) {}
    return false;
  },
});

app.get('/api/update/status', requireAuth, requirePermission('admin.system'), (req,res)=>{
  res.json(updater.status());
});
app.post('/api/update/check', requireAuth, csrfCheck, requirePermission('admin.system'), async (req,res)=>{
  try { const r = await updater.check(); res.json(r); }
  catch(e){ res.status(502).json({error:(e&&e.message)||'Check failed'}); }
});
app.post('/api/update/apply', requireAuth, csrfCheck, requirePermission('admin.system'), (req,res)=>{
  const st = updater.status();
  if (st.progress && st.progress.applying) return res.status(409).json({error:'An update is already in progress'});
  const actor = req.session.displayName || req.session.username || 'admin';
  audit(req,'update.apply.start','system',null,'Software update started',{by:actor});
  updater.apply(actor).catch(()=>{}); // runs in background; client polls /status
  res.json({ ok:true, started:true });
});
app.get('/api/update/backups', requireAuth, requirePermission('admin.system'), (req,res)=>{
  res.json(updater.backups());
});
app.post('/api/update/rollback', requireAuth, csrfCheck, requirePermission('admin.system'), async (req,res)=>{
  const actor = req.session.displayName || req.session.username || 'admin';
  try { const r = await updater.rollback(actor); res.json(r); }
  catch(e){ res.status(400).json({error:(e&&e.message)||'Rollback failed'}); }
});

// Liveness probe for the bootstrap supervisor (unauthenticated — no PHI).
app.get('/api/health', (req,res)=>{ let v='0.0.0'; try { v=require('./package.json').version; } catch(e){} res.json({ ok:true, version:v }); });

// ── Central / HQ link (Phase 0: connect + check-in) ───────────────
// Facility node → central HQ server. OUTBOUND only; the facility keeps operating
// normally if HQ is unreachable. Phase 0 is enrollment + liveness; sync is Phase 1.
const _httpsMod = require('https');
const _httpMod  = require('http');
function _centralRequest(method, urlStr, { headers = {}, body = null, insecure = false, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlStr); } catch (e) { return reject(new Error('Invalid HQ URL')); }
    const mod = u.protocol === 'https:' ? _httpsMod : _httpMod;
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const opts = {
      method, hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'content-type': 'application/json', ...(data ? { 'content-length': data.length } : {}), ...headers },
      timeout,
    };
    if (u.protocol === 'https:' && insecure) opts.rejectUnauthorized = false; // scoped to this call only
    const r = mod.request(opts, resp => {
      let buf = ''; resp.on('data', d => buf += d);
      resp.on('end', () => { let parsed = null; try { parsed = JSON.parse(buf); } catch (e) {} resolve({ status: resp.statusCode, body: parsed }); });
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('HQ connection timed out')));
    if (data) r.write(data);
    r.end();
  });
}
function _centralTs() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
const _appVersion = (() => { try { return require('./package.json').version; } catch (e) { return ''; } })();

app.get('/api/central/status', requireAuth, requirePermission('admin.system'), (req, res) => {
  const url = db.getSetting('central_url', '');
  const facility_id = db.getSetting('central_facility_id', '');
  const api_key = db.getSetting('central_api_key', '');
  res.json({
    connected: !!(url && facility_id && api_key),
    url, facility_id,
    key_prefix: api_key ? String(api_key).slice(0, 8) : '', // never return the full key
    insecure: !!db.getSetting('central_insecure_tls', false),
    last_checkin: db.getSetting('central_last_checkin', ''),
    last_status: db.getSetting('central_last_status', ''),
    pending: db.outboxPending(),
    last_sync: db.getSetting('central_last_sync', ''),
    sync_error: db.getSetting('central_sync_error', ''),
    manages_users: !!db.getSetting('central_manages_users', false),
    users_last_pull: db.getSetting('central_users_last_pull', ''),
    users_count: parseInt(db.getSetting('central_users_count', '0')) || 0,
    target_version: db.getSetting('central_target_version', ''),
    current_version: _appVersion,
    update_available: !!(db.getSetting('central_target_version', '') && db.getSetting('central_target_version', '') !== _appVersion),
    auto_update: !!db.getSetting('central_auto_update', false),
    update_window: db.getSetting('central_update_window', ''),
  });
});

// Opt-in to HQ-driven rollouts (auto-apply within an optional maintenance window).
app.post('/api/central/auto-update', requireAuth, csrfCheck, requirePermission('admin.system'), (req, res) => {
  const b = req.body || {};
  db.setSetting('central_auto_update', !!b.auto_update);
  if (b.window !== undefined) {
    const w = String(b.window || '').trim();
    if (w && !/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(w)) return res.status(400).json({ error: 'window must be "HH:MM-HH:MM" or empty' });
    db.setSetting('central_update_window', w);
  }
  audit(req, 'central.auto_update', 'system', null, 'Auto-update ' + (b.auto_update ? 'enabled' : 'disabled'), { window: db.getSetting('central_update_window', '') });
  res.json({ ok: true, auto_update: !!db.getSetting('central_auto_update', false), update_window: db.getSetting('central_update_window', '') });
});

app.post('/api/central/connect', requireAuth, csrfCheck, requirePermission('admin.system'), async (req, res) => {
  const url = String((req.body && req.body.url) || '').trim().replace(/\/+$/, '');
  const facility_id = String((req.body && req.body.facility_id) || '').trim();
  const api_key = String((req.body && req.body.api_key) || '').trim();
  const insecure = !!(req.body && req.body.insecure);
  if (!url || !facility_id || !api_key) return res.status(400).json({ error: 'HQ URL, Facility ID and enrollment key are all required' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'HQ URL must start with http:// or https://' });
  let r;
  try { r = await _centralRequest('POST', url + '/enroll/checkin', { headers: { 'x-facility-key': api_key }, body: { app_version: _appVersion }, insecure }); }
  catch (e) { return res.status(502).json({ error: 'Could not reach HQ: ' + ((e && e.message) || 'network error') }); }
  if (r.status !== 200 || !r.body || !r.body.ok)
    return res.status(r.status === 401 || r.status === 403 ? r.status : 502).json({ error: (r.body && r.body.error) || ('HQ rejected check-in (HTTP ' + r.status + ')') });
  if (r.body.facility && r.body.facility.id && r.body.facility.id !== facility_id)
    return res.status(400).json({ error: 'This key belongs to a different facility — check the Facility ID' });
  db.setSetting('central_url', url);
  db.setSetting('central_facility_id', facility_id);
  db.setSetting('central_api_key', api_key);
  db.setSetting('central_insecure_tls', insecure);
  db.setSetting('central_last_checkin', _centralTs());
  db.setSetting('central_last_status', 'connected');
  db.setSetting('central_sync_error', '');
  db.setSetting('central_target_version', (r.body && r.body.target_version) || '');
  // Phase 5: pull updates from HQ on the LAN. Preserve the original (GitHub)
  // manifest URL so disconnect can restore it.
  if (!db.getSetting('update_manifest_url_origin', '')) db.setSetting('update_manifest_url_origin', db.getSetting('update_manifest_url', ''));
  db.setSetting('update_manifest_url', url + '/fleet/manifest');
  try { db.enqueueSyncBackfill(); } catch (e) {}        // queue a full snapshot for HQ
  setImmediate(() => { syncTick().catch(() => {}); });   // start draining in the background
  audit(req, 'central.connect', 'system', null, 'Connected to HQ', { url, facility_id, central_name: (r.body.facility && r.body.facility.name) || '' });
  res.json({ ok: true, central: { name: (r.body.facility && r.body.facility.name) || '', server_time: r.body.server_time || '' } });
});

app.post('/api/central/checkin', requireAuth, csrfCheck, requirePermission('admin.system'), async (req, res) => {
  const url = db.getSetting('central_url', ''), api_key = db.getSetting('central_api_key', '');
  const insecure = !!db.getSetting('central_insecure_tls', false);
  if (!url || !api_key) return res.status(400).json({ error: 'Not connected to HQ' });
  let r;
  try { r = await _centralRequest('POST', url + '/enroll/checkin', { headers: { 'x-facility-key': api_key }, body: { app_version: _appVersion }, insecure }); }
  catch (e) { db.setSetting('central_last_status', 'unreachable'); return res.status(502).json({ error: 'Could not reach HQ: ' + ((e && e.message) || 'network error') }); }
  if (r.status !== 200 || !r.body || !r.body.ok) {
    db.setSetting('central_last_status', 'rejected');
    return res.status(502).json({ error: (r.body && r.body.error) || ('HQ rejected check-in (HTTP ' + r.status + ')') });
  }
  db.setSetting('central_last_checkin', _centralTs());
  db.setSetting('central_last_status', 'connected');
  db.setSetting('central_target_version', (r.body && r.body.target_version) || '');
  res.json({ ok: true, central: { name: (r.body.facility && r.body.facility.name) || '', server_time: r.body.server_time || '' } });
});

app.post('/api/central/disconnect', requireAuth, csrfCheck, requirePermission('admin.system'), (req, res) => {
  // Restore the original (GitHub) update source before clearing central settings.
  const origin = db.getSetting('update_manifest_url_origin', '');
  if (origin) { db.setSetting('update_manifest_url', origin); db.setSetting('update_manifest_url_origin', ''); }
  ['central_url', 'central_facility_id', 'central_api_key', 'central_insecure_tls',
   'central_last_checkin', 'central_last_status', 'central_last_sync', 'central_sync_error',
   'central_manages_users', 'central_users_last_pull', 'central_users_count', 'central_target_version',
   'central_auto_update', 'central_update_window']
    .forEach(k => db.setSetting(k, ''));
  // Previously-provisioned managed users are LEFT in place (real accounts with
  // their own passwords) so disconnecting never locks staff out.
  audit(req, 'central.disconnect', 'system', null, 'Disconnected from HQ', {});
  try { db.clearOutbox(); } catch (e) {}   // clear LAST so the audit row above doesn't linger in the outbox
  res.json({ ok: true });
});

// Drain the outbox to HQ. Safe to call anytime; when no central is configured it
// just keeps the outbox bounded (standalone facility). Runs on a timer, after a
// successful connect, and on demand via /api/central/sync-now.
let _syncing = false;
async function syncTick() {
  if (_syncing) return;
  _syncing = true;
  try {
    const url = db.getSetting('central_url', ''), key = db.getSetting('central_api_key', '');
    const insecure = !!db.getSetting('central_insecure_tls', false);
    if (!url || !key) { db.clearOutbox(); return; }   // standalone: nothing to send
    let batches = 0, lastUpdate = null;
    do {
      const batch = db.getSyncBatch(50);   // may be empty → still send as a heartbeat (refreshes liveness + target)
      let r;
      try { r = await _centralRequest('POST', url + '/sync/ingest', { headers: { 'x-facility-key': key }, body: { rows: batch, app_version: _appVersion, update_status: _localUpdateStatus() }, insecure, timeout: 30000 }); }
      catch (e) { db.setSetting('central_sync_error', (e && e.message) || 'network error'); db.setSetting('central_last_status', 'unreachable'); return; }
      if (r.status !== 200 || !r.body || !r.body.ok) {
        db.setSetting('central_sync_error', (r.body && r.body.error) || ('HTTP ' + r.status));
        db.setSetting('central_last_status', r.status === 401 || r.status === 403 ? 'rejected' : 'error');
        return;
      }
      if (batch.length) db.markSynced(batch.map(b => b.id));
      db.setSetting('central_last_status', 'connected');
      db.setSetting('central_sync_error', '');
      if (r.body.target_version !== undefined) db.setSetting('central_target_version', r.body.target_version || '');
      lastUpdate = r.body.update || null;
      batches++;
    } while (db.outboxPending() > 0 && batches < 20);
    db.pruneOutbox();
    db.setSetting('central_last_sync', _centralTs());
    await pullManagedUsers();
    await _maybeAutoUpdate(lastUpdate);   // Phase 5: act on a rollout directive (opt-in + window-gated)
  } finally { _syncing = false; }
}

// ── Phase 5: rollout auto-apply agent ─────────────────────────────────────
// Report this node's update outcome to HQ, derived from updater/bootstrap markers.
function _localUpdateStatus() {
  try {
    const upDir = path.join(DATA, 'updates');
    const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(upDir, f), 'utf8')); } catch (e) { return null; } };
    const applied = rd('last-applied.json');     // updater wrote on apply {to, ts}
    const rolled = rd('last-rollback.json');      // bootstrap wrote on auto-rollback {from, to, ts}
    if (rolled && (!applied || String(rolled.ts) >= String(applied.ts)))
      return { state: 'rolled_back', version: _appVersion, attempted: rolled.to || '' };
    if (applied && applied.to === _appVersion)
      return { state: 'updated', version: _appVersion, attempted: applied.to };
    return { state: 'idle', version: _appVersion };
  } catch (e) { return { state: 'idle', version: _appVersion }; }
}
// "HH:MM-HH:MM" local window; empty = anytime. Handles windows crossing midnight.
function _inUpdateWindow() {
  const w = String(db.getSetting('central_update_window', '') || '').trim();
  if (!w) return true;
  const m = w.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return true;
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const a = parseInt(m[1]) * 60 + parseInt(m[2]), b = parseInt(m[3]) * 60 + parseInt(m[4]);
  return a <= b ? (cur >= a && cur <= b) : (cur >= a || cur <= b);
}
const _autoTried = new Set();   // versions attempted this process (avoid tight retry loops)
async function _maybeAutoUpdate(d) {
  if (!d || !d.version || d.apply !== 'auto') return;
  if (!db.getSetting('central_auto_update', false)) return;       // opt-in per facility
  if (d.version === _appVersion || _autoTried.has(d.version)) return;
  if (!_inUpdateWindow()) return;                                 // outside maintenance window
  const st = updater.status();
  if (st && st.progress && st.progress.applying) return;          // already applying
  _autoTried.add(d.version);
  try {
    db.auditLog(null, 'central-rollout', '127.0.0.1', 'update.auto', 'system', null, _appVersion + ' -> ' + d.version, {});
    await updater.apply('central-rollout');   // pulls HQ fleet manifest (update_manifest_url), verifies signature, applies, restarts
  } catch (e) { db.setSetting('central_sync_error', 'auto-update: ' + ((e && e.message) || 'error')); }
}

// Pull HQ-managed users down and apply locally (Phase 2b; opt-in). No-op unless
// connected AND central_manages_users is enabled for this facility.
async function pullManagedUsers() {
  const url = db.getSetting('central_url', ''), key = db.getSetting('central_api_key', '');
  const insecure = !!db.getSetting('central_insecure_tls', false);
  if (!url || !key || !db.getSetting('central_manages_users', false)) return;
  let r;
  try { r = await _centralRequest('GET', url + '/sync/users', { headers: { 'x-facility-key': key }, insecure, timeout: 20000 }); }
  catch (e) { db.setSetting('central_sync_error', 'users: ' + ((e && e.message) || 'network error')); return; }
  if (r.status !== 200 || !r.body || !r.body.ok) { db.setSetting('central_sync_error', 'users: ' + ((r.body && r.body.error) || ('HTTP ' + r.status))); return; }
  try { db.applyManagedUsers(r.body.users || []); db.setSetting('central_users_last_pull', _centralTs()); }
  catch (e) { db.setSetting('central_sync_error', 'users-apply: ' + ((e && e.message) || 'error')); }
}

app.post('/api/central/sync-now', requireAuth, csrfCheck, requirePermission('admin.system'), async (req, res) => {
  if (!db.getSetting('central_url', '') || !db.getSetting('central_api_key', ''))
    return res.status(400).json({ error: 'Not connected to HQ' });
  await syncTick();
  res.json({ ok: true, pending: db.outboxPending(), last_sync: db.getSetting('central_last_sync', ''), last_status: db.getSetting('central_last_status', ''), error: db.getSetting('central_sync_error', '') });
});

// Toggle opt-in HQ user management for this facility (default off → no change to
// current behavior). Enabling triggers an immediate pull.
app.post('/api/central/manage-users', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
  if (!db.getSetting('central_url', '') || !db.getSetting('central_api_key', ''))
    return res.status(400).json({ error: 'Not connected to HQ' });
  const enabled = !!(req.body && req.body.enabled);
  db.setSetting('central_manages_users', enabled);
  audit(req, 'central.manage_users', 'system', null, enabled ? 'Enabled HQ user management' : 'Disabled HQ user management', {});
  if (enabled) await pullManagedUsers();
  res.json({ ok: true, enabled, count: parseInt(db.getSetting('central_users_count', '0')) || 0, last_pull: db.getSetting('central_users_last_pull', '') });
});

app.post('/api/central/pull-users', requireAuth, csrfCheck, requirePermission('admin.users'), async (req, res) => {
  if (!db.getSetting('central_url', '') || !db.getSetting('central_api_key', ''))
    return res.status(400).json({ error: 'Not connected to HQ' });
  if (!db.getSetting('central_manages_users', false)) return res.status(400).json({ error: 'HQ user management is off' });
  await pullManagedUsers();
  res.json({ ok: true, count: parseInt(db.getSetting('central_users_count', '0')) || 0, last_pull: db.getSetting('central_users_last_pull', ''), error: db.getSetting('central_sync_error', '') });
});

// ── React SPA catch-all (MUST be last — after all API routes) ────
app.get('*',(req,res)=>{
  if (!req.path.startsWith('/api/')) res.sendFile(path.join(REACT_DIST,'index.html'));
  else res.status(404).json({error:'Not found'});
});

// ── Start ─────────────────────────────────────────────────────────
db.init(DB_PATH);

// Export app + db so integration tests (supertest) can import the configured
// Express app without binding a port. The listener, TLS detection, WebSocket
// server, and browser launch only run when server.js is executed directly.
module.exports = { app, db };

if (require.main === module) (()=>{
  // Clean up mojibake middle-dot in facility name (Â· = double-encoded ·)
  {
    const fn = db.getSetting('facility_name','');
    if (fn && fn.includes('Â·')) {
      const fixed = fn.replace(/Â·/g, '·');
      db.setSetting('facility_name', fixed);
      db.save();
      console.log('  Fixed facility name encoding:', fixed);
    }
  }

  const CERT=path.join(DATA,'cert.pem'), KEY=path.join(DATA,'key.pem');
  const useTLS=fs.existsSync(CERT)&&fs.existsSync(KEY);
  let server;
  if(useTLS){ server=https.createServer({cert:fs.readFileSync(CERT),key:fs.readFileSync(KEY)},app); console.log('  TLS: HTTPS enabled'); }
  else { server=http.createServer(app); }

  // Now we know TLS status — update session cookie secure flag
  _sessionMiddleware = buildSession(useTLS);
  wss=new WebSocket.Server({server,verifyClient:(info,cb)=>{
    // Authenticate WebSocket handshake using the same session middleware
    const req=info.req; req.res={setHeader:()=>{},getHeader:()=>null};
    _sessionMiddleware(req,{},()=>{
      if(req.session&&req.session.userId) cb(true);
      else cb(false,401,'Unauthorized');
    });
  }});
  setWss(wss);  // hand the live server to the broadcast module
  wss.on('connection',ws=>{
    // C1: Drop all incoming messages from clients — server-only broadcasts
    // Clients must use REST API; no peer-to-peer relay allowed
    ws.on('message',()=>{});
  });

  // Scheduled database backup (45 CFR §164.308(a)(7)(ii)(A) — Required)
  backup.start(db);

  // Hourly lock sweep — auto-locks clinical records past their 24h grace window
  setInterval(() => {
    try {
      const n = db.runLockSweep();
      if (n > 0) console.log(`  [lock-sweep] locked ${n} clinical records past 24h grace`);
    } catch(e) {}
  }, 60 * 60 * 1000);

  const proto=useTLS?'https':'http', ip=getLocalIP();
  db.auditLog(null,'system','127.0.0.1','server.start','server',null,'OpsPoint',{version:'2.4.0',tls:useTLS});
  server.listen(PORT,'0.0.0.0',()=>{
    console.log('\n══════════════════════════════════════════════');
    console.log('  OpsPoint v2.4.0');
    console.log('══════════════════════════════════════════════');
    console.log(`  Desktop:  ${proto}://localhost:${PORT}`);
    console.log(`  Mobile:   ${proto}://${ip}:${PORT}`);
    console.log(`  Admin:    ${proto}://localhost:${PORT}/admin`);
    console.log('══════════════════════════════════════════════');
    console.log('══════════════════════════════════════════════\n');
    const{exec}=require('child_process');
    setTimeout(()=>exec(`start ${proto}://localhost:${PORT}`),1200);
  });

  // Multi-facility sync agent — drain the outbox to HQ shortly after boot, then
  // every 20s. No-op (and keeps the outbox bounded) when no central is configured.
  setTimeout(() => { syncTick().catch(() => {}); }, 5000);
  setInterval(() => { syncTick().catch(() => {}); }, 20000);
})();
