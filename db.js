/**
 * db.js — SQLite layer using sql.js (pure JS, no native compilation)
 * Load DB into memory at startup, flush to disk after every write.
 */
'use strict';
const initSqlJs = require('sql.js');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

let _db  = null;
let _dbPath = null;

const DEFAULT_WALK_AREAS = [
  'Supply Room','Basement / Offices','Kitchen','Meeting Room','Dining Room',
  'Laundry Area','Clothing Closet','Stairs to Roof','Floors 2, 3 & 4',
  'Stairs Down to Main','Perimeter Check'
];
const DEFAULT_UA_PANEL = ['ETG','THC','K2','FEN','AMP','MDMA','MET','PCP','MOR','OXY','OPI','BZO','MTD','BUP','COC'];

// ── Permission system ─────────────────────────────────────────────
const PERMISSIONS = [
  'reports.create',   // create / save shift reports
  'reports.close',    // close a shift
  'reports.delete',   // delete a report
  'log.add',          // add log entries
  'log.delete',       // delete log entries
  'issues.edit',      // add / remove issues & concerns and medical notes
  'status.edit',      // change resident status badges (In Building, At Work, etc.)
  'residents.edit',   // edit resident info (room, name, case manager, phone, dates)
  'staff.edit',       // add / edit / delete staff members and categories
  'chores.edit',      // assign chores and log completions
  'passes.edit',      // create / edit / delete passes and pass notice
  'reminders.view',   // see wellness check and walkthrough reminder banners
  'ua.request',       // flag a resident for UA from the roster
  'ua.acknowledge',   // see the UA alert banner and acknowledge requests
  'ua.delete',        // delete individual UA log entries from the report
  'mail.log',         // log incoming resident mail
  'mail.approve',     // approve logged mail for delivery to resident
  'facility.manage',  // room and roster management
  'admin.users',      // user management
  'admin.settings',   // facility settings write
  'mobile.access',    // use the basic mobile shift interface (mobile.html)
  'mobile.full',      // use the full-featured mobile app (mobile-full.html)
];

const ROLE_PRESETS = {
  monitor: [
    'reports.create', 'reports.close', 'log.add', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.edit',
    'reminders.view', 'ua.acknowledge', 'mail.log', 'mobile.access',
  ],
  supervisor: [
    'reports.create', 'reports.close', 'log.add', 'log.delete', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.edit', 'passes.edit',
    'reminders.view', 'ua.request', 'ua.acknowledge', 'mail.log',
    'mobile.access', 'mobile.full',
  ],
  admin: [
    'reports.create', 'reports.close', 'reports.delete',
    'log.add', 'log.delete', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.edit', 'passes.edit',
    'ua.request', 'ua.acknowledge', 'ua.delete', 'mail.log', 'mail.approve',
    'facility.manage', 'admin.users', 'admin.settings', 'mobile.access', 'mobile.full',
  ],
  case_manager: [
    'residents.edit', 'staff.edit', 'passes.edit',
    'ua.request', 'ua.delete', 'mail.approve', 'mobile.full',
  ],
};

// ── Init ─────────────────────────────────────────────────────────
async function init(dbPath) {
  _dbPath = dbPath;
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    _db = new SQL.Database(fs.readFileSync(dbPath));
    console.log('  DB: Loaded', path.basename(dbPath));
  } else {
    _db = new SQL.Database();
    console.log('  DB: Created', path.basename(dbPath));
  }
  _db.run('PRAGMA foreign_keys = ON');
  _createSchema();
  // Migrations — add columns that may not exist in older DBs
  try { _run("ALTER TABLE users ADD COLUMN must_change_pw INTEGER DEFAULT 0"); } catch(e) {}
  try { _run("ALTER TABLE reports ADD COLUMN roster_snapshot TEXT DEFAULT NULL"); } catch(e) {}
  try { _run("ALTER TABLE clients ADD COLUMN chore TEXT DEFAULT ''"); } catch(e) {}
  try { _run("ALTER TABLE clients ADD COLUMN chore_time TEXT DEFAULT ''"); } catch(e) {}
  try { _run("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL"); } catch(e) {}
  _seedDefaults();
  _seedExistingUserPermissions();
  _migratePermissions();
  _migrateProfiles();
  _save();
  pruneAuditLog(365); // Keep 1 year of audit history
}

function _createSchema() {
  _db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS clients (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    room           TEXT    NOT NULL,
    name           TEXT    NOT NULL DEFAULT 'VACANT',
    case_manager   TEXT    DEFAULT '',
    phone          TEXT    DEFAULT '',
    photo          TEXT    DEFAULT NULL,
    intake_date    TEXT    DEFAULT NULL,
    discharge_date TEXT    DEFAULT NULL,
    is_special     INTEGER DEFAULT 0,
    is_active      INTEGER DEFAULT 1,
    special_label  TEXT    DEFAULT NULL,
    sort_order     INTEGER DEFAULT 0
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS reports (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date      TEXT,
    shift            TEXT,
    mod_name         TEXT DEFAULT '',
    is_closed        INTEGER DEFAULT 0,
    statuses         TEXT DEFAULT '{}',
    comments         TEXT DEFAULT '{}',
    last_ua          TEXT DEFAULT '{}',
    last_room_search TEXT DEFAULT '{}',
    issues           TEXT DEFAULT '[]',
    med_notes        TEXT DEFAULT '[]',
    roster_snapshot  TEXT DEFAULT NULL,
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS log_entries (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
    time      TEXT,
    text      TEXT,
    ua_photo  TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT UNIQUE NOT NULL,
    display_name TEXT,
    role         TEXT DEFAULT 'monitor',
    hash         TEXT,
    salt         TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    must_change_pw INTEGER DEFAULT 0,
    permissions  TEXT DEFAULT NULL
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS staff (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    category   TEXT    NOT NULL DEFAULT '',
    name       TEXT    NOT NULL DEFAULT '',
    phone      TEXT    DEFAULT '',
    phone2     TEXT    DEFAULT '',
    notes      TEXT    DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS passes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER NOT NULL,
    room        TEXT    NOT NULL DEFAULT '',
    name        TEXT    NOT NULL DEFAULT '',
    departure   TEXT    DEFAULT '',
    return_date TEXT    DEFAULT '',
    ua_notes    TEXT    DEFAULT '',
    notes       TEXT    DEFAULT '',
    status      TEXT    DEFAULT 'Out',
    created_at  TEXT    DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS chore_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    log_date  TEXT    NOT NULL,
    initials  TEXT    DEFAULT '',
    UNIQUE(client_id, log_date)
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS ua_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL,
    client_name     TEXT    DEFAULT '',
    room            TEXT    DEFAULT '',
    requested_by    TEXT    DEFAULT '',
    requested_at    TEXT    DEFAULT (datetime('now')),
    acknowledged    INTEGER DEFAULT 0,
    acknowledged_by TEXT    DEFAULT '',
    acknowledged_at TEXT    DEFAULT ''
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS mail_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id    INTEGER NOT NULL,
    client_name  TEXT    DEFAULT '',
    room         TEXT    DEFAULT '',
    logged_by    TEXT    DEFAULT '',
    logged_at    TEXT    DEFAULT (datetime('now')),
    report_id    INTEGER DEFAULT NULL,
    notes        TEXT    DEFAULT '',
    status       TEXT    DEFAULT 'pending',
    approved_by  TEXT    DEFAULT '',
    approved_at  TEXT    DEFAULT '',
    delivered_at TEXT    DEFAULT '',
    created_at   TEXT    DEFAULT (datetime('now'))
  )`);
  _db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT    NOT NULL DEFAULT (datetime('now')),
    actor_id     INTEGER DEFAULT NULL,
    actor_name   TEXT    DEFAULT '',
    ip           TEXT    DEFAULT '',
    action       TEXT    NOT NULL,
    target_type  TEXT    DEFAULT '',
    target_id    TEXT    DEFAULT '',
    target_label TEXT    DEFAULT '',
    detail       TEXT    DEFAULT ''
  )`);
}

function _hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pw, salt, 600000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function _defaultProfiles() {
  return [
    { key: 'monitor',      label: 'Monitor',       permissions: ROLE_PRESETS.monitor.slice() },
    { key: 'supervisor',   label: 'Supervisor',     permissions: ROLE_PRESETS.supervisor.slice() },
    { key: 'admin',        label: 'Administrator',  permissions: ROLE_PRESETS.admin.slice() },
    { key: 'case_manager', label: 'Case Manager',   permissions: ROLE_PRESETS.case_manager.slice() },
  ];
}

function getPermissionProfiles() {
  return getSetting('permission_profiles', _defaultProfiles());
}

function setPermissionProfiles(profiles) {
  setSetting('permission_profiles', profiles);
}

function _seedDefaults() {
  const defs = {
    facility_name:          'ShiftPoint',
    wellness_interval_mins: '120',
    walk_interval_mins:     '240',
    walk_areas:             JSON.stringify(DEFAULT_WALK_AREAS),
    ua_panel:               JSON.stringify(DEFAULT_UA_PANEL),
    wellness_schedule:      '[]',
    walk_schedule:          '[]',
    logo_pdec:              '',
    logo_wcs:               '',
    active_report_id:       'null',
    master_chores:          '[]',
    pass_notice:            '""',
    staff_categories:       JSON.stringify(['Director','Case Manager','Monitor','Other']),
  };
  for (const [k, v] of Object.entries(defs)) {
    if (!_q1('SELECT key FROM settings WHERE key=?', [k]))
      _run('INSERT INTO settings (key,value) VALUES (?,?)', [k, v]);
  }
  // Seed permission profiles if not yet stored
  if (!_q1('SELECT key FROM settings WHERE key=?', ['permission_profiles']))
    _run('INSERT INTO settings (key,value) VALUES (?,?)', ['permission_profiles', JSON.stringify(_defaultProfiles())]);
  const cnt = _q1('SELECT COUNT(*) as c FROM users');
  if (!cnt || cnt.c === 0) {
    // VULN-22: Random secure passwords on first seed — never hardcode credentials
    function _randPw() {
      const upper='ABCDEFGHJKLMNPQRSTUVWXYZ', lower='abcdefghjkmnpqrstuvwxyz';
      const digits='23456789', syms='!@#$%^&*';
      const all=upper+lower+digits+syms;
      const bytes=require('crypto').randomBytes(16);
      let pw=upper[bytes[0]%upper.length]+lower[bytes[1]%lower.length]+digits[bytes[2]%digits.length]+syms[bytes[3]%syms.length];
      for(let i=4;i<16;i++) pw+=all[bytes[i]%all.length];
      return pw.split('').sort(()=>Math.random()-.5).join('');
    }
    const adminPw=_randPw(), supPw=_randPw(), monPw=_randPw();
    const a=_hashPw(adminPw), s=_hashPw(supPw), m=_hashPw(monPw);
    console.log('\n  ╔══════════════════════════════════════════════╗');
    console.log('  ║  FIRST-RUN CREDENTIALS (change on login)     ║');
    console.log('  ╠══════════════════════════════════════════════╣');
    console.log('  ║  admin      / ' + adminPw.padEnd(32) + '║');
    console.log('  ║  supervisor / ' + supPw.padEnd(32) + '║');
    console.log('  ║  monitor    / ' + monPw.padEnd(32) + '║');
    console.log('  ╚══════════════════════════════════════════════╝\n');
    _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions) VALUES ('admin','Administrator','admin',?,?,1,?)`,[a.hash,a.salt,JSON.stringify(ROLE_PRESETS.admin)]);
    _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions) VALUES ('supervisor','Supervisor','supervisor',?,?,1,?)`,[s.hash,s.salt,JSON.stringify(ROLE_PRESETS.supervisor)]);
    _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions) VALUES ('monitor','Monitor','monitor',?,?,1,?)`,[m.hash,m.salt,JSON.stringify(ROLE_PRESETS.monitor)]);
  }
}

// Seed permissions for existing users that predate the permission system
function _seedExistingUserPermissions() {
  const users = _q('SELECT id, role FROM users WHERE permissions IS NULL');
  users.forEach(u => {
    const perms = ROLE_PRESETS[u.role] || ROLE_PRESETS.monitor;
    _run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(perms), u.id]);
  });
}

// Migrate permissions for existing users when new permissions are added to presets
function _migratePermissions() {
  const users = _q('SELECT id, role, permissions FROM users WHERE permissions IS NOT NULL');
  users.forEach(u => {
    try {
      const perms = JSON.parse(u.permissions || '[]');
      let changed = false;
      // v1.14: monitors and supervisors get ua.acknowledge (split from ua.request)
      if ((u.role === 'monitor' || u.role === 'supervisor') && !perms.includes('ua.acknowledge')) {
        perms.push('ua.acknowledge'); changed = true;
      }
      // v1.14: monitors get mail.log; supervisors/admins get mail.log + mail.approve
      if ((u.role === 'monitor' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('mail.log')) {
        perms.push('mail.log'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('mail.approve')) {
        perms.push('mail.approve'); changed = true;
      }
      // v1.14.1: monitors, supervisors, and admins get status.edit
      if ((u.role === 'monitor' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('status.edit')) {
        perms.push('status.edit'); changed = true;
      }
      // v1.14.x: monitors, supervisors, and admins get issues.edit
      if ((u.role === 'monitor' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('issues.edit')) {
        perms.push('issues.edit'); changed = true;
      }
      // v1.14.x: supervisors and admins get ua.delete
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('ua.delete')) {
        perms.push('ua.delete'); changed = true;
      }
      // v1.14.x: monitors and supervisors get reminders.view
      if ((u.role === 'monitor' || u.role === 'supervisor') && !perms.includes('reminders.view')) {
        perms.push('reminders.view'); changed = true;
      }
      // v1.14.x: monitors, supervisors, and admins get mobile.access by default
      if ((u.role === 'monitor' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('mobile.access')) {
        perms.push('mobile.access'); changed = true;
      }
      // v1.14.x: supervisors and admins get mobile.full
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('mobile.full')) {
        perms.push('mobile.full'); changed = true;
      }
      if (changed) _run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(perms), u.id]);
    } catch(e) {}
  });
}

// Migrate stored permission profiles when new permissions are added to ROLE_PRESETS
function _migrateProfiles() {
  const profiles = getPermissionProfiles();
  let changed = false;
  profiles.forEach(p => {
    const preset = ROLE_PRESETS[p.key];
    if (!preset) return;
    // Add any permissions in the current preset that are missing from the stored profile
    preset.forEach(perm => {
      if (!p.permissions.includes(perm)) {
        p.permissions.push(perm);
        changed = true;
      }
    });
  });
  if (changed) setSetting('permission_profiles', profiles);
}

// ── Core helpers ─────────────────────────────────────────────────
function _run(sql, params=[]) { _db.run(sql, params); }
function _q(sql, params=[]) {
  const stmt = _db.prepare(sql); stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free(); return rows;
}
function _q1(sql, params=[]) { return _q(sql,params)[0]||null; }
function _save() {
  if (!_db||!_dbPath) return;
  fs.writeFileSync(_dbPath, Buffer.from(_db.export()));
}
function _j(str, def) { try { return JSON.parse(str); } catch(e) { return def; } }

// ── Public API ────────────────────────────────────────────────────
function query(sql, p=[])  { return _q(sql,p); }
function query1(sql, p=[]) { return _q1(sql,p); }
function run(sql, p=[])    { _run(sql,p); }
function save()             { _save(); }
function runAndSave(sql,p) { _run(sql,p); _save(); }

function getSetting(key, def=null) {
  const row = _q1('SELECT value FROM settings WHERE key=?',[key]);
  if (!row) return def;
  return _j(row.value, row.value);
}
function setSetting(key, val) {
  const v = typeof val==='string' ? val : JSON.stringify(val);
  _run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)',[key,v]);
}
function setSettingAndSave(key,val) { setSetting(key,val); _save(); }

// ── Photo helpers ─────────────────────────────────────────────────
function savePhoto(b64, fname) {
  if (!b64||!b64.startsWith('data:')) return b64;
  const dir = path.join(path.dirname(_dbPath),'photos');
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,fname), Buffer.from(b64.split(',')[1],'base64'));
  return 'photos/'+fname;
}
function getPhotoB64(p) {
  if (!p) return null;
  if (p.startsWith('data:')) return p;
  // Prevent path traversal — only serve files inside the data/photos directory
  const photosDir = path.resolve(path.dirname(_dbPath), 'photos');
  const full = path.resolve(path.dirname(_dbPath), p);
  if (!full.startsWith(photosDir + path.sep) && !full.startsWith(photosDir + '/')) return null;
  if (!fs.existsSync(full)) return null;
  const ext = path.extname(full).slice(1).toLowerCase();
  return `data:${ext==='gif'?'image/gif':'image/jpeg'};base64,${fs.readFileSync(full).toString('base64')}`;
}
function resolveClientPhoto(photo) {
  if (!photo) return null;
  if (photo.startsWith('data:')) return photo;
  return getPhotoB64(photo);
}

// ── Full data (legacy JSON shape) ────────────────────────────────
function getAllData() {
  const clients = _q('SELECT * FROM clients ORDER BY sort_order, CAST(room AS INTEGER), room');
  clients.forEach(c => {
    c.is_special = !!c.is_special; c.is_active = !!c.is_active;
    c.photo = resolveClientPhoto(c.photo);
  });

  const reports = _q('SELECT * FROM reports ORDER BY created_at');
  reports.forEach(r => {
    r.is_closed        = !!r.is_closed;
    r.statuses         = _j(r.statuses, {});
    r.comments         = _j(r.comments, {});
    r.last_ua          = _j(r.last_ua, {});
    r.last_room_search = _j(r.last_room_search, {});
    r.issues           = _j(r.issues, []);
    r.med_notes        = _j(r.med_notes, []);
    r.roster_snapshot = _j(r.roster_snapshot, null);
    r.log_entries = _q('SELECT * FROM log_entries WHERE report_id=? ORDER BY rowid',[r.id]);
    r.log_entries.forEach(function(e){
      // ua_photo resolved on demand via /api/log/:id/photo — skip inline base64 here
      if (e.ua_photo && (typeof e.ua_photo !== 'string' || !e.ua_photo.startsWith('data:'))) {
        e.ua_photo = true; // signal that photo exists without embedding it
      }
    });
  });

  const logoP = getSetting('logo_pdec','');
  const logoW = getSetting('logo_wcs','');

  const today = new Date().toISOString().slice(0,10);
  const staffRows = _q('SELECT * FROM staff ORDER BY sort_order, id');
  const passRows  = _q('SELECT * FROM passes ORDER BY CASE status WHEN \'Out\' THEN 0 WHEN \'Extended\' THEN 1 ELSE 2 END, return_date ASC');
  const choreLog  = _q('SELECT * FROM chore_log WHERE log_date=?', [today]);

  return {
    clients, reports,
    logos:                  { pdec: getPhotoB64(logoP)||null, wcs: getPhotoB64(logoW)||null },
    facility_name:          getSetting('facility_name',          'ShiftPoint'),
    wellness_interval_mins: getSetting('wellness_interval_mins', 120),
    walk_interval_mins:     getSetting('walk_interval_mins',     240),
    walk_areas:             getSetting('walk_areas',             DEFAULT_WALK_AREAS),
    ua_panel:               getSetting('ua_panel',               DEFAULT_UA_PANEL),
    wellness_schedule:      getSetting('wellness_schedule',      []),
    walk_schedule:          getSetting('walk_schedule',          []),
    active_report_id:       getSetting('active_report_id',       null),
    staff:                  staffRows,
    passes:                 passRows,
    chore_log:              choreLog,
    master_chores:          getSetting('master_chores',          []),
    pass_notice:            getSetting('pass_notice',            ''),
    staff_categories:       getSetting('staff_categories',       ['Director','Case Manager','Monitor','Other']),
  };
}

// ── Report upsert ─────────────────────────────────────────────────
function upsertReport(r) {
  const now = new Date().toISOString();
  const exists = _q1('SELECT id FROM reports WHERE id=?',[r.id]);
  if (exists) {
    // Capture roster snapshot when closing a shift (only set once, never overwritten)
    if (r.is_closed && r.roster_snapshot) {
      const existing = _q1('SELECT roster_snapshot FROM reports WHERE id=?',[r.id]);
      if (!existing || !existing.roster_snapshot) {
        _run('UPDATE reports SET roster_snapshot=? WHERE id=?',
          [JSON.stringify(r.roster_snapshot), r.id]);
      }
    }
    _run(`UPDATE reports SET report_date=?,shift=?,mod_name=?,is_closed=?,statuses=?,
      comments=?,last_ua=?,last_room_search=?,issues=?,med_notes=?,updated_at=? WHERE id=?`,
      [r.report_date||'',r.shift||'',r.mod_name||'',r.is_closed?1:0,
       JSON.stringify(r.statuses||{}),JSON.stringify(r.comments||{}),
       JSON.stringify(r.last_ua||{}),JSON.stringify(r.last_room_search||{}),
       JSON.stringify(r.issues||[]),JSON.stringify(r.med_notes||[]),now,r.id]);
    // Sync log entries — dedup by (time,text) prevents double-insert on repeated saves
    const existingEntries = _q('SELECT id,time,text FROM log_entries WHERE report_id=?',[r.id]);
    const existingIds = existingEntries.map(e=>e.id);
    const incomingIds = (r.log_entries||[]).filter(e=>e.id).map(e=>parseInt(e.id));
    // Delete DB entries that are not in incoming AND not matched by a no-ID entry (time+text)
    const noIdEntries = (r.log_entries||[]).filter(e=>!e.id);
    existingIds.filter(id=>!incomingIds.includes(id)).forEach(id=>{
      const dbEntry = existingEntries.find(ex=>ex.id===id);
      if (!dbEntry) return;
      // Check if a no-ID incoming entry matches this DB entry — if so, keep it
      const matchedByText = noIdEntries.some(e=>
        (e.time||'')===(dbEntry.time||'') && (e.text||'')===(dbEntry.text||'')
      );
      if (!matchedByText) {
        _run('DELETE FROM log_entries WHERE id=?',[id]);
      }
    });
    (r.log_entries||[]).forEach(e=>{
      if (e.id && existingIds.includes(parseInt(e.id))) {
        // If ua_photo is the sentinel (true/1) don't overwrite the real filename in the DB
        const isSentinel = e.ua_photo === true || e.ua_photo === 1;
        if (isSentinel) {
          _run('UPDATE log_entries SET time=?,text=? WHERE id=?',
            [e.time||'',e.text||'',e.id]);
        } else {
          _run('UPDATE log_entries SET time=?,text=?,ua_photo=? WHERE id=?',
            [e.time||'',e.text||'',e.ua_photo||null,e.id]);
        }
      } else if (!e.id) {
        // Only insert if no existing entry with same time+text (prevents duplication on re-save)
        const dup = existingEntries.find(ex=>ex.time===(e.time||'')&&ex.text===(e.text||''));
        if (!dup) {
          _run('INSERT INTO log_entries (report_id,time,text,ua_photo) VALUES (?,?,?,?)',
            [r.id,e.time||'',e.text||'',e.ua_photo||null]);
        }
      }
    });
  } else {
    if (r.id) {
      _run(`INSERT INTO reports (id,report_date,shift,mod_name,is_closed,statuses,comments,
        last_ua,last_room_search,issues,med_notes,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.id,r.report_date||'',r.shift||'',r.mod_name||'',r.is_closed?1:0,
         JSON.stringify(r.statuses||{}),JSON.stringify(r.comments||{}),
         JSON.stringify(r.last_ua||{}),JSON.stringify(r.last_room_search||{}),
         JSON.stringify(r.issues||[]),JSON.stringify(r.med_notes||[]),now,now]);
    } else {
      _run(`INSERT INTO reports (report_date,shift,mod_name,is_closed,statuses,comments,
        last_ua,last_room_search,issues,med_notes,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.report_date||'',r.shift||'',r.mod_name||'',r.is_closed?1:0,
         JSON.stringify(r.statuses||{}),JSON.stringify(r.comments||{}),
         JSON.stringify(r.last_ua||{}),JSON.stringify(r.last_room_search||{}),
         JSON.stringify(r.issues||[]),JSON.stringify(r.med_notes||[]),now,now]);
    }
    const newId = _j(JSON.stringify(_db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]),null);
    const useId = r.id || newId;
    (r.log_entries||[]).forEach(e=>{
      _run('INSERT INTO log_entries (report_id,time,text,ua_photo) VALUES (?,?,?,?)',
        [useId,e.time||'',e.text||'',e.ua_photo||null]);
    });
  }
}

// ── Audit Log ─────────────────────────────────────────────────────
function auditLog(actorId, actorName, ip, action, targetType, targetId, targetLabel, detail) {
  try {
    _run(
      `INSERT INTO audit_log (actor_id,actor_name,ip,action,target_type,target_id,target_label,detail) VALUES (?,?,?,?,?,?,?,?)`,
      [
        actorId || null,
        String(actorName || '').slice(0, 100),
        String(ip || '').slice(0, 60),
        String(action || ''),
        String(targetType || '').slice(0, 50),
        String(targetId != null ? targetId : '').slice(0, 50),
        String(targetLabel || '').slice(0, 200),
        (typeof detail === 'object' && detail !== null)
          ? JSON.stringify(detail).slice(0, 2000)
          : String(detail || '').slice(0, 2000),
      ]
    );
    _save();
  } catch(e) { /* never let audit failure crash the caller */ }
}

function getAuditLog({actionPrefixes, actorId, from, to, search, limit, offset} = {}) {
  var where = [], params = [];
  if (actionPrefixes && actionPrefixes.length > 0) {
    var conditions = actionPrefixes.map(function(){ return 'action LIKE ?'; }).join(' OR ');
    where.push('(' + conditions + ')');
    actionPrefixes.forEach(function(p){ params.push(p + '.%'); });
  }
  if (actorId) { where.push('actor_id=?'); params.push(parseInt(actorId)); }
  if (from)    { where.push("ts >= ?");    params.push(from); }
  if (to)      { where.push("ts <= ?");    params.push(to.length === 10 ? to + ' 23:59:59' : to); }
  if (search) {
    var s = '%' + String(search).replace(/[%_]/g, '\\$&') + '%';
    where.push('(actor_name LIKE ? OR action LIKE ? OR target_label LIKE ? OR detail LIKE ?)');
    params.push(s, s, s, s);
  }
  var wc  = where.length ? 'WHERE ' + where.join(' AND ') : '';
  var lim = Math.min(parseInt(limit) || 100, 500);
  var off = parseInt(offset) || 0;
  var countRow = _q1('SELECT COUNT(*) as c FROM audit_log ' + wc, params);
  var rows = _q('SELECT * FROM audit_log ' + wc + ' ORDER BY id DESC LIMIT ? OFFSET ?', params.concat([lim, off]));
  return { rows: rows, total: countRow ? countRow.c : 0 };
}

function pruneAuditLog(days) {
  days = days || 365;
  try {
    var cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    _run('DELETE FROM audit_log WHERE ts < ?', [cutoff]);
    _save();
  } catch(e) {}
}

module.exports = {
  init, save, query, query1, run, runAndSave,
  getSetting, setSetting, setSettingAndSave,
  getAllData, upsertReport, savePhoto, getPhotoB64,
  DEFAULT_WALK_AREAS, DEFAULT_UA_PANEL,
  PERMISSIONS, ROLE_PRESETS,
  getPermissionProfiles, setPermissionProfiles,
  auditLog, getAuditLog, pruneAuditLog,
};