/**
 * central/db.js — Central / HQ database layer (SQLite via better-sqlite3, WAL).
 *
 * This is the ONLY module that talks SQL. Routes call the exported functions,
 * never raw SQL. Keeping the data-access boundary here means swapping SQLite for
 * Postgres later (when facility count / report volume demands it) is a contained
 * change, not a rewrite. See docs/MULTI_FACILITY_PLAN.md §5.
 *
 * Phase 0 scope: facility registry + org-admin auth + node check-in.
 * Phase 1 will add the facility_id-tagged mirror tables + sync ingest.
 */
'use strict';
const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

let _db = null;
let _dbPath = null;

// "YYYY-MM-DD HH:MM:SS" local time (avoid datetime('now') which is UTC).
function nowLocal() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── Init ────────────────────────────────────────────────────────────────
function init(dbPath) {
  _dbPath = dbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const isNew = !fs.existsSync(dbPath);
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  console.log('  Central DB:', isNew ? 'Created' : 'Loaded', path.basename(dbPath));
  _createSchema();
  _migrate();
  _seedDefaults();
}

// Additive column migrations (try/catch — harmless if the column already exists).
function _migrate() {
  const cols = [
    "upd_state TEXT DEFAULT ''",        // facility self-reported: ''|updating|updated|failed|rolled_back
    "upd_attempted TEXT DEFAULT ''",    // version it last tried
    "upd_error TEXT DEFAULT ''",
    "upd_reported_at TEXT",
  ];
  for (const c of cols) { try { _db.exec('ALTER TABLE facilities ADD COLUMN ' + c); } catch (e) {} }
}

function _createSchema() {
  _db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Org-level administrators (manage the fleet from HQ). Separate from any
  // facility's local users — these accounts never sync down.
  _db.exec(`CREATE TABLE IF NOT EXISTS central_users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT UNIQUE NOT NULL,
    display_name   TEXT DEFAULT '',
    role           TEXT DEFAULT 'admin',
    hash           TEXT,
    salt           TEXT,
    must_change_pw INTEGER DEFAULT 0,
    created_at     TEXT DEFAULT (datetime('now'))
  )`);

  // The fleet. id is a UUID generated here and handed to the facility node at
  // enrollment. The API key is shown once at creation; only its SHA-256 hash
  // is stored (keys are 256-bit random, so a fast hash is sufficient).
  _db.exec(`CREATE TABLE IF NOT EXISTS facilities (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    api_key_hash   TEXT NOT NULL UNIQUE,
    api_key_prefix TEXT DEFAULT '',
    status         TEXT DEFAULT 'active',   -- active | disabled
    app_version    TEXT DEFAULT '',
    last_seen_at   TEXT DEFAULT NULL,
    last_seen_ip   TEXT DEFAULT '',
    created_at     TEXT DEFAULT (datetime('now'))
  )`);

  // Per-facility sync cursor (Phase 1 uses applied_through to dedupe ingest).
  _db.exec(`CREATE TABLE IF NOT EXISTS sync_state (
    facility_id     TEXT PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
    applied_through INTEGER DEFAULT 0,
    updated_at      TEXT DEFAULT NULL
  )`);

  // Central audit trail (enrollment, key rotation, check-ins, logins).
  _db.exec(`CREATE TABLE IF NOT EXISTS audit (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT DEFAULT (datetime('now')),
    actor   TEXT DEFAULT '',
    action  TEXT NOT NULL,
    target  TEXT DEFAULT '',
    detail  TEXT DEFAULT '',
    ip      TEXT DEFAULT ''
  )`);

  // Phase 1: synced facility rows, stored generically as JSON keyed by
  // (facility_id, table_name, source_id). Schema-agnostic — new facility
  // columns never break ingest; Phase 2 reporting can read via json_extract.
  _db.exec(`CREATE TABLE IF NOT EXISTS facility_data (
    facility_id TEXT NOT NULL,
    table_name  TEXT NOT NULL,
    source_id   INTEGER NOT NULL,
    data        TEXT,
    updated_at  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (facility_id, table_name, source_id)
  )`);
  _db.exec('CREATE INDEX IF NOT EXISTS idx_fdata_fac_table ON facility_data(facility_id, table_name)');

  // Phase 2b: HQ-mastered user directory, pushed DOWN to assigned facilities.
  // Stores an INITIAL credential (PBKDF2); the facility owns the password after
  // first change. role drives permissions via the facility's own ROLE_PRESETS.
  _db.exec(`CREATE TABLE IF NOT EXISTS managed_users (
    id             TEXT PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE,
    display_name   TEXT DEFAULT '',
    role           TEXT DEFAULT 'pa',
    permissions    TEXT DEFAULT '[]',
    hash           TEXT, salt TEXT,
    must_change_pw INTEGER DEFAULT 1,
    status         TEXT DEFAULT 'active',   -- active | disabled
    created_at     TEXT DEFAULT (datetime('now'))
  )`);
  _db.exec(`CREATE TABLE IF NOT EXISTS managed_user_facilities (
    user_id     TEXT NOT NULL,
    facility_id TEXT NOT NULL,
    PRIMARY KEY (user_id, facility_id)
  )`);

  // Phase 3: release store. HQ imports a signed release once (from GitHub), then
  // relays the bundle to enrolled facilities over the authenticated channel so
  // facilities never need internet. Bundles live on disk in data/releases/.
  _db.exec(`CREATE TABLE IF NOT EXISTS releases (
    channel    TEXT NOT NULL,             -- 'facility' | 'central'
    version    TEXT NOT NULL,
    filename   TEXT NOT NULL,
    size       INTEGER NOT NULL,
    sha256     TEXT NOT NULL,
    signature  TEXT,
    sig_alg    TEXT DEFAULT 'ed25519',
    min_node   TEXT,
    min_from   TEXT,
    changelog  TEXT DEFAULT '[]',
    released   TEXT,
    notes      TEXT DEFAULT '',
    status     TEXT DEFAULT 'published',  -- published | yanked
    created_at TEXT,
    PRIMARY KEY (channel, version)
  )`);

  // Phase 5: one active rollout per channel. The engine issues per-facility update
  // directives based on state + canary membership, and auto-advances/-pauses on
  // facilities' self-reported health.
  _db.exec(`CREATE TABLE IF NOT EXISTS rollouts (
    channel    TEXT PRIMARY KEY,           -- 'facility'
    version    TEXT NOT NULL,
    state      TEXT NOT NULL DEFAULT 'paused', -- paused | canary | active | complete
    canary_ids TEXT DEFAULT '[]',          -- JSON array of facility ids
    notes      TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT
  )`);
}

// ── Low-level helpers (private) ──────────────────────────────────────────
function _run(sql, p = []) { return _db.prepare(sql).run(...p); }
function _q(sql, p = [])   { return _db.prepare(sql).all(...p); }
function _q1(sql, p = [])  { return _db.prepare(sql).get(...p) || null; }
function _j(s, def) { try { return JSON.parse(s); } catch (e) { return def; } }

// ── Settings ─────────────────────────────────────────────────────────────
function getSetting(key, def = null) {
  const row = _q1('SELECT value FROM settings WHERE key=?', [key]);
  if (!row) return def;
  return _j(row.value, row.value);
}
function setSetting(key, val) {
  const v = typeof val === 'string' ? val : JSON.stringify(val);
  _run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [key, v]);
}

// ── Crypto ───────────────────────────────────────────────────────────────
function _hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pw, salt, 600000, 64, 'sha512').toString('hex');
  return { hash, salt };
}
function _verifyPw(pw, hash, salt) {
  if (!hash || !salt) return false;
  const h = crypto.pbkdf2Sync(pw, salt, 600000, 64, 'sha512').toString('hex');
  const a = Buffer.from(h, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function _sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function _randPw() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789', syms = '!@#$%^&*';
  const all = upper + lower + digits + syms;
  const bytes = crypto.randomBytes(16);
  let pw = upper[bytes[0] % upper.length] + lower[bytes[1] % lower.length] +
           digits[bytes[2] % digits.length] + syms[bytes[3] % syms.length];
  for (let i = 4; i < 16; i++) pw += all[bytes[i] % all.length];
  return pw.split('').sort(() => Math.random() - 0.5).join('');
}

// ── Seed ─────────────────────────────────────────────────────────────────
function _seedDefaults() {
  if (!getSetting('session_secret'))
    setSetting('session_secret', crypto.randomBytes(32).toString('hex'));

  // HQ self-update manifest (central tier). Points at the public releases repo's
  // latest central manifest; editable from the console. apply() still requires a
  // valid Ed25519 signature regardless of source.
  // Migrate old key name → update_manifest_url (what the shared updater reads).
  if (getSetting('central_update_manifest_url') !== null && getSetting('update_manifest_url') === null) {
    setSetting('update_manifest_url', getSetting('central_update_manifest_url'));
  }
  if (getSetting('update_manifest_url') === null)
    setSetting('update_manifest_url',
      'https://github.com/harrisb415/opspoint-releases/releases/latest/download/central-manifest.json');
  if (getSetting('releases_facility_manifest_url') === null)
    setSetting('releases_facility_manifest_url',
      'https://github.com/harrisb415/opspoint-releases/releases/latest/download/update-manifest.json');
  if (getSetting('releases_central_manifest_url') === null)
    setSetting('releases_central_manifest_url',
      'https://github.com/harrisb415/opspoint-releases/releases/latest/download/central-manifest.json');

  const cnt = _q1('SELECT COUNT(*) AS c FROM central_users');
  if (!cnt || cnt.c === 0) {
    const pw = process.env.CENTRAL_ADMIN_PW || _randPw();
    const { hash, salt } = _hashPw(pw);
    _run(`INSERT INTO central_users (username,display_name,role,hash,salt,must_change_pw)
          VALUES ('admin','HQ Administrator','admin',?,?,1)`, [hash, salt]);
    if (!process.env.CENTRAL_ADMIN_PW) {
      console.log('\n  ╔══════════════════════════════════════════════╗');
      console.log('  ║  CENTRAL FIRST-RUN ADMIN (change on login)   ║');
      console.log('  ╠══════════════════════════════════════════════╣');
      console.log('  ║  admin / ' + pw.padEnd(37) + '║');
      console.log('  ╚══════════════════════════════════════════════╝\n');
    } else {
      console.log('  Central admin seeded from CENTRAL_ADMIN_PW env.');
    }
  }
}

// ── Audit ────────────────────────────────────────────────────────────────
function audit({ actor = '', action, target = '', detail = '', ip = '' }) {
  _run('INSERT INTO audit (ts,actor,action,target,detail,ip) VALUES (?,?,?,?,?,?)',
    [nowLocal(), actor, action, target, detail, ip]);
}
function getAudit(limit = 200) {
  return _q('SELECT * FROM audit ORDER BY id DESC LIMIT ?', [limit]);
}

// ── Central users / auth ─────────────────────────────────────────────────
function authUser(username, password) {
  const u = _q1('SELECT * FROM central_users WHERE username=?', [String(username || '').toLowerCase().trim()]);
  if (!u || !_verifyPw(password, u.hash, u.salt)) return null;
  return { id: u.id, username: u.username, display_name: u.display_name, role: u.role, must_change_pw: !!u.must_change_pw };
}
function getUser(id) {
  const u = _q1('SELECT id,username,display_name,role,must_change_pw FROM central_users WHERE id=?', [id]);
  if (!u) return null;
  return { id: u.id, username: u.username, display_name: u.display_name, role: u.role, must_change_pw: !!u.must_change_pw };
}
// Self-service: the signed-in admin sets their OWN password → clears the
// must-change flag (they've now chosen it).
function setUserPassword(id, newPw) {
  const { hash, salt } = _hashPw(newPw);
  _run('UPDATE central_users SET hash=?,salt=?,must_change_pw=0 WHERE id=?', [hash, salt, id]);
}

// ── HQ admin accounts (central_users) — the fleet operators ───────────────
// These accounts log into this console only; they never sync down to any
// facility. Distinct from managed_users (which DO push down to facilities).
function listCentralUsers() {
  return _q('SELECT id,username,display_name,role,must_change_pw,created_at FROM central_users ORDER BY username')
    .map(u => ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role, must_change_pw: !!u.must_change_pw, created_at: u.created_at }));
}
function countCentralUsers() {
  const r = _q1('SELECT COUNT(*) AS c FROM central_users');
  return r ? r.c : 0;
}
function createCentralUser({ username, display_name, password }) {
  username = String(username || '').toLowerCase().trim();
  if (!username) throw new Error('username required');
  if (!/^[a-z0-9._-]+$/.test(username)) throw new Error('username may contain only letters, numbers, dot, dash, underscore');
  if (_q1('SELECT id FROM central_users WHERE username=?', [username])) throw new Error('username already exists');
  if (!password || String(password).length < 10) throw new Error('password must be at least 10 characters');
  const { hash, salt } = _hashPw(String(password));
  const info = _run(`INSERT INTO central_users (username,display_name,role,hash,salt,must_change_pw,created_at)
        VALUES (?,?,'admin',?,?,1,?)`, [username, String(display_name || '').trim(), hash, salt, nowLocal()]);
  return getUser(info.lastInsertRowid);
}
// Reset ANOTHER admin's password → sets must-change so they pick a new one
// on their next sign-in. (Self-service uses setUserPassword above.)
function resetCentralUserPassword(id, newPw) {
  if (!newPw || String(newPw).length < 10) throw new Error('password must be at least 10 characters');
  const { hash, salt } = _hashPw(String(newPw));
  _run('UPDATE central_users SET hash=?,salt=?,must_change_pw=1 WHERE id=?', [hash, salt, id]);
}
function deleteCentralUser(id) {
  _run('DELETE FROM central_users WHERE id=?', [id]);
}

// ── Release store (Phase 3) — HQ relays signed bundles to the fleet ───────
function _cmpSemver(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return 1; if ((pa[i] || 0) < (pb[i] || 0)) return -1; }
  return 0;
}
function _pubRelease(r) { if (!r) return null; return Object.assign({}, r, { changelog: _j(r.changelog, []) }); }
function getRelease(channel, version) {
  return _pubRelease(_q1('SELECT * FROM releases WHERE channel=? AND version=?', [channel, version]));
}
function recordRelease(rec) {
  _run(`INSERT OR REPLACE INTO releases
        (channel,version,filename,size,sha256,signature,sig_alg,min_node,min_from,changelog,released,notes,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rec.channel, rec.version, rec.filename, rec.size, rec.sha256, rec.signature || null, rec.sig_alg || 'ed25519',
     rec.min_node || null, rec.min_from || null, JSON.stringify(rec.changelog || []), rec.released || null,
     rec.notes || '', rec.status || 'published', nowLocal()]);
  return getRelease(rec.channel, rec.version);
}
function listReleases(channel) {
  const rows = channel
    ? _q('SELECT * FROM releases WHERE channel=? ORDER BY created_at DESC', [channel])
    : _q('SELECT * FROM releases ORDER BY channel, created_at DESC');
  return rows.map(_pubRelease);
}
function getLatestPublishedRelease(channel) {
  const rows = _q("SELECT * FROM releases WHERE channel=? AND status='published'", [channel]).map(_pubRelease);
  if (!rows.length) return null;
  rows.sort((a, b) => _cmpSemver(b.version, a.version));
  return rows[0];
}
function setReleaseStatus(channel, version, status) {
  _run('UPDATE releases SET status=? WHERE channel=? AND version=?', [status === 'yanked' ? 'yanked' : 'published', channel, version]);
  return getRelease(channel, version);
}

// ── Rollout engine (Phase 5) — staged, health-gated fleet rollout ─────────
function getRollout(channel) {
  const r = _q1('SELECT * FROM rollouts WHERE channel=?', [channel]);
  if (!r) return null;
  return Object.assign({}, r, { canary_ids: _j(r.canary_ids, []) });
}
function startRollout(channel, version, canaryIds, notes) {
  const ids = Array.isArray(canaryIds) ? canaryIds.filter(Boolean) : [];
  const state = ids.length ? 'canary' : 'active';
  _run(`INSERT INTO rollouts (channel,version,state,canary_ids,notes,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(channel) DO UPDATE SET version=excluded.version, state=excluded.state,
          canary_ids=excluded.canary_ids, notes=excluded.notes, updated_at=excluded.updated_at`,
    [channel, version, state, JSON.stringify(ids), notes || '', nowLocal(), nowLocal()]);
  return getRollout(channel);
}
function setRolloutState(channel, state) {
  _run('UPDATE rollouts SET state=?, updated_at=? WHERE channel=?', [state, nowLocal(), channel]);
  return getRollout(channel);
}
function recordFacilityUpdateStatus(facilityId, s) {
  s = s || {};
  _run('UPDATE facilities SET upd_state=?, upd_attempted=?, upd_error=?, upd_reported_at=? WHERE id=?',
    [String(s.state || ''), String(s.attempted || ''), String(s.error || '').slice(0, 300), nowLocal(), facilityId]);
}

// What (if anything) an eligible facility should be told to install right now.
function rolloutEligible(facility) {
  const ro = getRollout('facility');
  if (!ro || ro.state === 'paused' || ro.state === 'complete') return null;
  if (!facility || facility.status !== 'active') return null;
  if ((facility.app_version || '') === ro.version) return null;               // already on target
  const eligible = ro.state === 'active' || (ro.state === 'canary' && ro.canary_ids.includes(facility.id));
  if (!eligible) return null;
  const rel = getRelease('facility', ro.version);
  if (!rel || rel.status !== 'published') return null;                        // version not (or no longer) served
  return { version: ro.version, release: rel };
}
function updateDirectiveFor(facility, baseUrl) {
  const e = rolloutEligible(facility);
  if (!e) return null;
  return {
    version: e.version, apply: 'auto', url: baseUrl + '/fleet/bundle/' + e.version,
    sha256: e.release.sha256, size: e.release.size, sig_alg: e.release.sig_alg, signature: e.release.signature,
  };
}

// Which release /fleet/manifest should serve THIS facility — enforces rollout
// gating at the serve layer so canary cohorts can't be bypassed:
//   canary/active → the rollout version, but only if this facility is eligible
//   paused        → nothing (kill switch)
//   none/complete → latest published (open, Phase-3 behavior)
function manifestReleaseFor(facility) {
  const ro = getRollout('facility');
  if (ro && (ro.state === 'canary' || ro.state === 'active')) {
    const e = rolloutEligible(facility);
    return e ? e.release : null;
  }
  if (ro && ro.state === 'paused') return null;
  return getLatestPublishedRelease('facility');
}

// Auto-advance (canary→active→complete) / auto-pause from self-reported health.
function evaluateRollout(channel) {
  const ro = getRollout(channel);
  if (!ro || ro.state === 'paused' || ro.state === 'complete') return ro;
  const facs = _q("SELECT id,app_version,upd_state,upd_attempted FROM facilities WHERE status='active'");
  const atTarget = f => (f.app_version || '') === ro.version;
  const failed = f => (f.upd_state === 'rolled_back' || f.upd_state === 'failed') && f.upd_attempted === ro.version;
  if (ro.state === 'canary') {
    const canary = facs.filter(f => ro.canary_ids.includes(f.id));
    if (canary.some(failed)) return setRolloutState(channel, 'paused');       // canary failed → halt
    if (canary.length && canary.every(atTarget)) return setRolloutState(channel, 'active'); // canary healthy → expand
    return ro;
  }
  // active
  if (facs.some(failed)) return setRolloutState(channel, 'paused');           // any failure → halt
  if (facs.length && facs.every(atTarget)) return setRolloutState(channel, 'complete');
  return ro;
}

// ── Facilities ───────────────────────────────────────────────────────────
const _FAC_COLS = 'id,name,api_key_prefix,status,app_version,last_seen_at,last_seen_ip,created_at,upd_state,upd_attempted,upd_error,upd_reported_at';
function listFacilities() {
  return _q('SELECT ' + _FAC_COLS + ' FROM facilities ORDER BY name');
}
function getFacility(id) {
  return _q1('SELECT ' + _FAC_COLS + ' FROM facilities WHERE id=?', [id]);
}

// Returns { id, name, apiKey } — apiKey is plaintext and shown ONLY here, once.
function createFacility(name) {
  const id     = crypto.randomUUID();
  const apiKey = crypto.randomBytes(32).toString('hex');
  const hash   = _sha256(apiKey);
  const prefix = apiKey.slice(0, 8);
  _run(`INSERT INTO facilities (id,name,api_key_hash,api_key_prefix,created_at)
        VALUES (?,?,?,?,?)`, [id, String(name).trim(), hash, prefix, nowLocal()]);
  _run('INSERT OR IGNORE INTO sync_state (facility_id,applied_through) VALUES (?,0)', [id]);
  return { id, name: String(name).trim(), apiKey };
}

// Rotate the API key (old key stops working immediately). Returns new plaintext key.
function rotateFacilityKey(id) {
  const apiKey = crypto.randomBytes(32).toString('hex');
  _run('UPDATE facilities SET api_key_hash=?, api_key_prefix=? WHERE id=?',
    [_sha256(apiKey), apiKey.slice(0, 8), id]);
  return apiKey;
}

function setFacilityStatus(id, status) {
  _run('UPDATE facilities SET status=? WHERE id=?', [status === 'disabled' ? 'disabled' : 'active', id]);
}

function deleteFacility(id) {
  // Remove all backed-up rows, managed-user assignments, and the facility record
  // (sync_state has ON DELETE CASCADE so it's handled automatically).
  _run('DELETE FROM facility_data WHERE facility_id=?', [id]);
  _run('DELETE FROM managed_user_facilities WHERE facility_id=?', [id]);
  _run('DELETE FROM facilities WHERE id=?', [id]);
}

// Look up a facility by its plaintext API key (constant-ish via unique hash index).
function facilityByKey(apiKey) {
  if (!apiKey) return null;
  return _q1('SELECT * FROM facilities WHERE api_key_hash=?', [_sha256(apiKey)]);
}

// Node check-in: record liveness + reported app version.
function touchFacility(id, { ip = '', app_version = '' } = {}) {
  _run('UPDATE facilities SET last_seen_at=?, last_seen_ip=?, app_version=? WHERE id=?',
    [nowLocal(), ip, app_version || '', id]);
}

// ── Sync ingest (Phase 1) ──────────────────────────────────────────────
function getAppliedThrough(facilityId) {
  const r = _q1('SELECT applied_through FROM sync_state WHERE facility_id=?', [facilityId]);
  return r ? r.applied_through : 0;
}

// Apply a batch of facility rows. Idempotent: upserts and deletes can be safely
// replayed, so a lost ACK that triggers a resend never corrupts state.
function ingestRows(facilityId, rows) {
  let stored = 0, deleted = 0, maxId = getAppliedThrough(facilityId);
  const ts = nowLocal();
  _db.transaction(() => {
    const up  = _db.prepare('INSERT OR REPLACE INTO facility_data (facility_id,table_name,source_id,data,updated_at) VALUES (?,?,?,?,?)');
    const del = _db.prepare('DELETE FROM facility_data WHERE facility_id=? AND table_name=? AND source_id=?');
    for (const r of rows || []) {
      if (!r || !r.table_name || r.row_id == null) continue;
      if (r.op === 'delete') { del.run(facilityId, r.table_name, r.row_id); deleted++; }
      else { up.run(facilityId, r.table_name, r.row_id, JSON.stringify(r.data || {}), ts); stored++; }
      if (typeof r.id === 'number' && r.id > maxId) maxId = r.id;
    }
    _run(`INSERT INTO sync_state (facility_id,applied_through,updated_at) VALUES (?,?,?)
          ON CONFLICT(facility_id) DO UPDATE SET applied_through=excluded.applied_through, updated_at=excluded.updated_at`,
      [facilityId, maxId, ts]);
  })();
  return { stored, deleted, applied_through: maxId };
}

function facilityTableCounts(facilityId) {
  const rows = _q('SELECT table_name, COUNT(*) AS c FROM facility_data WHERE facility_id=? GROUP BY table_name ORDER BY table_name', [facilityId]);
  const tables = {}; let total = 0;
  rows.forEach(r => { tables[r.table_name] = r.c; total += r.c; });
  return { total, tables, applied_through: getAppliedThrough(facilityId) };
}

// Parsed rows for one facility table (feeds Phase 2 reporting + verification).
function getFacilityRows(facilityId, table, limit = 1000) {
  const rows = _q('SELECT source_id, data, updated_at FROM facility_data WHERE facility_id=? AND table_name=? ORDER BY source_id LIMIT ?', [facilityId, table, limit]);
  return rows.map(r => { let d = null; try { d = JSON.parse(r.data); } catch (e) {} return { source_id: r.source_id, data: d, updated_at: r.updated_at }; });
}

// ── Cross-facility reporting (Phase 2a) ────────────────────────────────
// HIPAA minimum-necessary: aggregate COUNTS only — never names/narratives/PHI.
// `cond` fragments are constant strings (no user input) → safe to interpolate.
function _count(facilityId, table, cond) {
  const r = _q1(`SELECT COUNT(*) AS c FROM facility_data WHERE facility_id=? AND table_name=?${cond ? ' AND ' + cond : ''}`, [facilityId, table]);
  return r ? r.c : 0;
}

function reportOverview() {
  const facs = _q('SELECT id,name,status,last_seen_at,app_version FROM facilities ORDER BY name');
  const now = Date.now();
  const target = getSetting('fleet_target_version', '') || '';
  const per = facs.map(f => {
    let online = false, dark = false;
    if (f.last_seen_at) { const t = new Date(f.last_seen_at.replace(' ', 'T')).getTime(); if (isFinite(t)) { const age = now - t; online = age < 120000; dark = age > 900000; } }
    const ct = facilityTableCounts(f.id);
    const version = f.app_version || '';
    return {
      id: f.id, name: f.name, status: f.status, app_version: version, version,
      last_seen_at: f.last_seen_at, online, dark,
      behind: !!(target && version && version !== target),
      residents:       _count(f.id, 'clients', "json_extract(data,'$.is_active')=1 AND json_extract(data,'$.is_special')=0 AND json_extract(data,'$.name')<>'VACANT'"),
      vacant:          _count(f.id, 'clients', "json_extract(data,'$.name')='VACANT'"),
      incidents_open:  _count(f.id, 'incidents', "json_extract(data,'$.status')='open'"),
      incidents_total: _count(f.id, 'incidents'),
      ua_total:        _count(f.id, 'ua_records'),
      // Facility stores UA outcome as pass/fail (fail = positive), NOT positive/negative.
      ua_positive:     _count(f.id, 'ua_records', "lower(json_extract(data,'$.result'))='fail'"),
      rows_total:      ct.total,
      applied_through: ct.applied_through,
    };
  });
  const sum = k => per.reduce((a, b) => a + (b[k] || 0), 0);
  return {
    facilities: per,
    target_version: target,
    totals: {
      facilities: per.length,
      online: per.filter(p => p.online).length,
      dark: per.filter(p => p.dark).length,
      on_target: target ? per.filter(p => p.version === target).length : 0,
      residents: sum('residents'), vacant: sum('vacant'),
      incidents_open: sum('incidents_open'), incidents_total: sum('incidents_total'),
      ua_total: sum('ua_total'), ua_positive: sum('ua_positive'),
      rows_total: sum('rows_total'),
    },
  };
}

// ── Fleet update coordination (Phase 3) ────────────────────────────────
// HQ records a recommended target version; nodes display it next to their own
// (proven) update flow. HQ does NOT push binaries — updater.js is untouched.
function getFleetTarget() {
  return { version: getSetting('fleet_target_version', '') || '', notes: getSetting('fleet_target_notes', '') || '' };
}
function setFleetTarget(version, notes) {
  setSetting('fleet_target_version', String(version || '').trim());
  setSetting('fleet_target_notes', String(notes || ''));
  return getFleetTarget();
}

// ── Managed users (Phase 2b) — HQ-mastered directory, pushed to facilities ──
function _publicManagedUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, display_name: u.display_name, role: u.role,
    permissions: _j(u.permissions, []), status: u.status, created_at: u.created_at,
    facilities: _q('SELECT facility_id FROM managed_user_facilities WHERE user_id=?', [u.id]).map(r => r.facility_id),
  };
}

function listManagedUsers() {
  return _q('SELECT * FROM managed_users ORDER BY username').map(_publicManagedUser);
}
function getManagedUser(id) { return _publicManagedUser(_q1('SELECT * FROM managed_users WHERE id=?', [id])); }

function createManagedUser({ username, display_name, role, password, facilities }) {
  username = String(username || '').toLowerCase().trim();
  if (!username) throw new Error('username required');
  if (_q1('SELECT id FROM managed_users WHERE username=?', [username])) throw new Error('username already exists');
  if (!password || String(password).length < 8) throw new Error('initial password must be at least 8 characters');
  const id = crypto.randomUUID();
  const { hash, salt } = _hashPw(String(password));
  _run(`INSERT INTO managed_users (id,username,display_name,role,hash,salt,must_change_pw,status,created_at)
        VALUES (?,?,?,?,?,?,1,'active',?)`,
    [id, username, String(display_name || '').trim(), String(role || 'pa'), hash, salt, nowLocal()]);
  setManagedUserFacilities(id, facilities || []);
  return getManagedUser(id);
}

function updateManagedUser(id, { display_name, role, status }) {
  const u = _q1('SELECT id FROM managed_users WHERE id=?', [id]);
  if (!u) throw new Error('not found');
  if (display_name !== undefined) _run('UPDATE managed_users SET display_name=? WHERE id=?', [String(display_name).trim(), id]);
  if (role !== undefined)         _run('UPDATE managed_users SET role=? WHERE id=?', [String(role), id]);
  if (status !== undefined)       _run('UPDATE managed_users SET status=? WHERE id=?', [status === 'disabled' ? 'disabled' : 'active', id]);
  return getManagedUser(id);
}

function setManagedUserPassword(id, password) {
  if (!password || String(password).length < 8) throw new Error('password must be at least 8 characters');
  const { hash, salt } = _hashPw(String(password));
  _run('UPDATE managed_users SET hash=?,salt=?,must_change_pw=1 WHERE id=?', [hash, salt, id]);
}

function setManagedUserFacilities(id, facilityIds) {
  _db.transaction(() => {
    _run('DELETE FROM managed_user_facilities WHERE user_id=?', [id]);
    for (const fid of facilityIds || []) {
      if (_q1('SELECT id FROM facilities WHERE id=?', [fid]))
        _run('INSERT OR IGNORE INTO managed_user_facilities (user_id,facility_id) VALUES (?,?)', [id, fid]);
    }
  })();
  return getManagedUser(id);
}

function deleteManagedUser(id) {
  _run('DELETE FROM managed_user_facilities WHERE user_id=?', [id]);
  _run('DELETE FROM managed_users WHERE id=?', [id]);
}

// The pull payload for one facility: active managed users with their INITIAL
// credential (hash/salt) + role. Travels over TLS to the facility node.
function getManagedUsersForFacility(facilityId) {
  return _q(`SELECT mu.* FROM managed_users mu
             JOIN managed_user_facilities f ON f.user_id=mu.id
             WHERE f.facility_id=? AND mu.status='active' ORDER BY mu.username`, [facilityId])
    .map(u => ({
      uid: u.id, username: u.username, display_name: u.display_name, role: u.role,
      permissions: _j(u.permissions, []), hash: u.hash, salt: u.salt, must_change_pw: !!u.must_change_pw,
    }));
}

module.exports = {
  init, nowLocal,
  getSetting, setSetting,
  audit, getAudit,
  authUser, getUser, setUserPassword,
  listCentralUsers, countCentralUsers, createCentralUser, resetCentralUserPassword, deleteCentralUser,
  recordRelease, getRelease, listReleases, getLatestPublishedRelease, setReleaseStatus,
  getRollout, startRollout, setRolloutState, recordFacilityUpdateStatus, updateDirectiveFor, evaluateRollout, manifestReleaseFor,
  listFacilities, getFacility, createFacility, rotateFacilityKey, setFacilityStatus, deleteFacility,
  facilityByKey, touchFacility,
  // Sync ingest (Phase 1)
  getAppliedThrough, ingestRows, facilityTableCounts, getFacilityRows,
  // Reporting (Phase 2a)
  reportOverview,
  // Fleet update coordination (Phase 3)
  getFleetTarget, setFleetTarget,
  // Managed users (Phase 2b)
  listManagedUsers, getManagedUser, createManagedUser, updateManagedUser,
  setManagedUserPassword, setManagedUserFacilities, deleteManagedUser,
  getManagedUsersForFacility,
};
