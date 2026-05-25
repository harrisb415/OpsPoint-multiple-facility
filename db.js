/**
 * db.js — SQLite layer using better-sqlite3 (native bindings, WAL mode)
 * Writes go directly to disk on every statement — no manual flush needed.
 */
'use strict';
const Database = require('better-sqlite3');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

let _db     = null;
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
  'passes.status',    // change pass In/Out status and mark as Returned (check in/out)
  'reminders.view',   // see wellness check and walkthrough reminder banners
  'ua.request',       // flag a resident for UA from the roster
  'ua.acknowledge',   // see the UA alert banner and acknowledge requests
  'ua.delete',        // delete individual UA log entries from the report
  'mail.log',         // log incoming resident mail
  'mail.approve',     // approve logged mail for delivery to resident
  'mail.delete',      // delete mail log records
  'infractions.log',      // log a new infraction
  'infractions.review',   // review an infraction (assign consequence or waive)
  'infractions.complete', // mark a consequence as completed
  'infractions.delete',   // permanently delete infraction records
  'infractions.notify_review',    // receive banner when an infraction is pending review
  'infractions.notify_consequence', // receive banner when a consequence is assigned
  'facility.manage',  // room and roster management
  'admin.users',      // user management
  'admin.settings',   // facility settings write
  'admin.audit',      // view the audit log
  'admin.system',     // access system controls (server restart)
  'mobile.access',    // use the mobile shift interface
  'broadcast.send',   // compose and send announcements to all staff
  'broadcast.receive',// receive announcements in the notification bell
  'ua.draw',          // run the random UA draw
];

const ROLE_PRESETS = {
  monitor: [
    'reports.create', 'reports.close', 'log.add', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.edit', 'passes.status',
    'reminders.view', 'ua.acknowledge', 'mail.log', 'infractions.log',
    'infractions.notify_consequence', 'mobile.access',
  ],
  supervisor: [
    'reports.create', 'reports.close', 'log.add', 'log.delete', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.edit', 'passes.edit', 'passes.status',
    'reminders.view', 'ua.request', 'ua.acknowledge', 'mail.log',
    'infractions.log', 'infractions.review', 'infractions.complete',
    'infractions.notify_review', 'infractions.notify_consequence',
    'broadcast.send', 'broadcast.receive', 'ua.draw',
    'mobile.access',
  ],
  admin: [
    'reports.create', 'reports.close', 'reports.delete',
    'log.add', 'log.delete', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.edit', 'passes.edit', 'passes.status',
    'ua.request', 'ua.delete', 'mail.log', 'mail.approve', 'mail.delete',
    'infractions.log', 'infractions.review', 'infractions.complete', 'infractions.delete',
    'infractions.notify_review', 'infractions.notify_consequence',
    'broadcast.send', 'broadcast.receive', 'ua.draw',
    'facility.manage', 'admin.users', 'admin.settings', 'admin.audit', 'admin.system',
    'mobile.access',
  ],
  case_manager: [
    'residents.edit', 'staff.edit', 'passes.edit',
    'ua.request', 'ua.delete', 'mail.approve',
    'infractions.notify_review',
    'broadcast.send', 'broadcast.receive',
    'mobile.access',
  ],
};

// ── Init (synchronous) ───────────────────────────────────────────────
function init(dbPath) {
  _dbPath = dbPath;
  const isNew = !fs.existsSync(dbPath);
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  console.log('  DB:', isNew ? 'Created' : 'Loaded', path.basename(dbPath));
  _createSchema();
  // Migrations — add columns that may not exist in older DBs
  const migrations = [
    "ALTER TABLE users ADD COLUMN must_change_pw INTEGER DEFAULT 0",
    "ALTER TABLE reports ADD COLUMN roster_snapshot TEXT DEFAULT NULL",
    "ALTER TABLE clients ADD COLUMN chore TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN chore_time TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL",
    "ALTER TABLE ua_requests ADD COLUMN is_interview INTEGER DEFAULT 0",
    "ALTER TABLE ua_requests ADD COLUMN interview_name TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN is_protected INTEGER DEFAULT 0",
  ];
  migrations.forEach(sql => { try { _db.exec(sql); } catch(e) {} });
  _seedDefaults();
  _seedExistingUserPermissions();
  _migratePermissions();
  _migrateProfiles();
  _seedGroups();
  _migrateUserGroups();
  _migrateGroups();
  pruneAuditLog(365);
}

function _createSchema() {
  _db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT
  )`);
  _db.exec(`CREATE TABLE IF NOT EXISTS clients (
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
  _db.exec(`CREATE TABLE IF NOT EXISTS reports (
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
  _db.exec(`CREATE TABLE IF NOT EXISTS log_entries (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
    time      TEXT,
    text      TEXT,
    ua_photo  TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  _db.exec(`CREATE TABLE IF NOT EXISTS users (
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
  _db.exec(`CREATE TABLE IF NOT EXISTS staff (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    category   TEXT    NOT NULL DEFAULT '',
    name       TEXT    NOT NULL DEFAULT '',
    phone      TEXT    DEFAULT '',
    phone2     TEXT    DEFAULT '',
    notes      TEXT    DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now'))
  )`);
  _db.exec(`CREATE TABLE IF NOT EXISTS passes (
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
  _db.exec(`CREATE TABLE IF NOT EXISTS chore_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    log_date  TEXT    NOT NULL,
    initials  TEXT    DEFAULT '',
    UNIQUE(client_id, log_date)
  )`);
  _db.exec(`CREATE TABLE IF NOT EXISTS ua_requests (
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
  _db.exec(`CREATE TABLE IF NOT EXISTS mail_log (
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
  _db.exec(`CREATE TABLE IF NOT EXISTS infractions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id        INTEGER NOT NULL,
    client_name      TEXT    DEFAULT '',
    room             TEXT    DEFAULT '',
    infraction_date  TEXT    DEFAULT '',
    description      TEXT    DEFAULT '',
    logged_by        TEXT    DEFAULT '',
    logged_at        TEXT    DEFAULT (datetime('now')),
    status           TEXT    DEFAULT 'pending',
    consequence      TEXT    DEFAULT '',
    consequence_by   TEXT    DEFAULT '',
    consequence_at   TEXT    DEFAULT '',
    completed_by     TEXT    DEFAULT '',
    completed_at     TEXT    DEFAULT '',
    notes            TEXT    DEFAULT '',
    created_at       TEXT    DEFAULT (datetime('now'))
  )`);
  _db.exec(`CREATE TABLE IF NOT EXISTS groups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    key          TEXT UNIQUE NOT NULL,
    label        TEXT NOT NULL,
    permissions  TEXT DEFAULT '[]',
    is_protected INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  )`);
  _db.exec(`CREATE TABLE IF NOT EXISTS user_groups (
    user_id  INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, group_id),
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )`);
  _db.exec(`CREATE TABLE IF NOT EXISTS ua_draws (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    drawn_by       INTEGER NOT NULL,
    drawn_by_name  TEXT    NOT NULL DEFAULT '',
    method         TEXT    NOT NULL DEFAULT 'random',
    residents      TEXT    NOT NULL DEFAULT '[]',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  _db.exec(`CREATE TABLE IF NOT EXISTS broadcast_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id    INTEGER NOT NULL,
    sender_name  TEXT    NOT NULL DEFAULT '',
    message      TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  _db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
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
    shift_day_start:        '07:00',
    shift_swing_start:      '15:00',
    shift_grave_start:      '23:00',
    ui_visibility:          JSON.stringify({tabs:{staff:true,chores:true,passes:true,caseloads:true,mail:true,reports:true,infractions:true},buttons:{wellness:true,walkthrough:true}}),
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
    _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES ('admin','Administrator','admin',?,?,1,?,1)`,[a.hash,a.salt,JSON.stringify(ROLE_PRESETS.admin)]);
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
      let perms = JSON.parse(u.permissions || '[]');
      let changed = false;
      if ((u.role === 'monitor' || u.role === 'supervisor') && !perms.includes('ua.acknowledge')) {
        perms.push('ua.acknowledge'); changed = true;
      }
      if ((u.role === 'monitor' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('mail.log')) {
        perms.push('mail.log'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('mail.approve')) {
        perms.push('mail.approve'); changed = true;
      }
      if ((u.role === 'monitor' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('status.edit')) {
        perms.push('status.edit'); changed = true;
      }
      if ((u.role === 'monitor' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('issues.edit')) {
        perms.push('issues.edit'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('ua.delete')) {
        perms.push('ua.delete'); changed = true;
      }
      if ((u.role === 'monitor' || u.role === 'supervisor') && !perms.includes('reminders.view')) {
        perms.push('reminders.view'); changed = true;
      }
      if ((u.role === 'monitor' || u.role === 'supervisor' || u.role === 'admin' || u.role === 'case_manager') && !perms.includes('mobile.access')) {
        perms.push('mobile.access'); changed = true;
      }
      // Strip deprecated mobile.full permission from existing users
      if (perms.includes('mobile.full')) {
        perms = perms.filter(p => p !== 'mobile.full'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('passes.status')) {
        perms.push('passes.status'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('mail.delete')) {
        perms.push('mail.delete'); changed = true;
      }
      if ((u.role === 'monitor' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('infractions.log')) {
        perms.push('infractions.log'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('infractions.review')) {
        perms.push('infractions.review'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('infractions.complete')) {
        perms.push('infractions.complete'); changed = true;
      }
      if (u.role === 'admin' && !perms.includes('infractions.delete')) {
        perms.push('infractions.delete'); changed = true;
      }
      if ((u.role === 'monitor' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('infractions.notify_consequence')) {
        perms.push('infractions.notify_consequence'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('infractions.notify_review')) {
        perms.push('infractions.notify_review'); changed = true;
      }
      if (changed) _run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(perms), u.id]);
    } catch(e) {}
  });
}

// Migrate stored permission profiles when new permissions are added to ROLE_PRESETS.
function _migrateProfiles() {
  const knownRaw = _q1('SELECT value FROM settings WHERE key=?', ['known_permissions']);
  const knownPerms = knownRaw ? JSON.parse(knownRaw.value || '[]') : null;
  const newPerms = knownPerms
    ? PERMISSIONS.filter(p => !knownPerms.includes(p))
    : [];
  const knownJson = JSON.stringify(PERMISSIONS);
  if (knownRaw) {
    _run('UPDATE settings SET value=? WHERE key=?', [knownJson, 'known_permissions']);
  } else {
    _run('INSERT INTO settings (key,value) VALUES (?,?)', ['known_permissions', knownJson]);
  }
  const profiles = getPermissionProfiles();
  let changed = false;
  profiles.forEach(p => {
    // Strip retired permissions
    const cleaned = p.permissions.filter(perm => PERMISSIONS.includes(perm));
    if (cleaned.length !== p.permissions.length) { p.permissions = cleaned; changed = true; }
    // Add new perms that belong to this profile's preset
    const preset = ROLE_PRESETS[p.key];
    if (preset) {
      newPerms.forEach(perm => {
        if (preset.includes(perm) && !p.permissions.includes(perm)) {
          p.permissions.push(perm);
          changed = true;
        }
      });
    }
  });
  if (changed) setSetting('permission_profiles', profiles);
}

// ── Groups ────────────────────────────────────────────────────────────
function _seedGroups() {
  const existing = _q1('SELECT COUNT(*) as c FROM groups');
  if (existing && existing.c > 0) return;
  const seeds = [
    { key: 'monitor',      label: 'Monitor',       permissions: ROLE_PRESETS.monitor,      is_protected: 0 },
    { key: 'supervisor',   label: 'Supervisor',     permissions: ROLE_PRESETS.supervisor,    is_protected: 0 },
    { key: 'admin',        label: 'Administrator',  permissions: ROLE_PRESETS.admin,         is_protected: 1 },
    { key: 'case_manager', label: 'Case Manager',   permissions: ROLE_PRESETS.case_manager,  is_protected: 0 },
  ];
  seeds.forEach(s => {
    _run('INSERT INTO groups (key,label,permissions,is_protected) VALUES (?,?,?,?)',
      [s.key, s.label, JSON.stringify(s.permissions), s.is_protected]);
  });
}

function _migrateUserGroups() {
  // Assign each user to their matching role group if not already in any group
  const usersNoGroups = _q(`
    SELECT u.id, u.role FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM user_groups ug WHERE ug.user_id=u.id)
  `);
  usersNoGroups.forEach(u => {
    const g = _q1('SELECT id FROM groups WHERE key=?', [u.role]);
    if (g) _run('INSERT OR IGNORE INTO user_groups (user_id,group_id) VALUES (?,?)', [u.id, g.id]);
  });
}

// Ensure every built-in group contains all permissions its ROLE_PRESET says it should have,
// and strip any retired permissions (no longer in PERMISSIONS) from every group.
// Runs on every boot — idempotent.
function _migrateGroups() {
  const groups = _q('SELECT * FROM groups');
  groups.forEach(g => {
    const perms   = _j(g.permissions, []);
    const preset  = ROLE_PRESETS[g.key];
    const missing = preset ? preset.filter(p => !perms.includes(p)) : [];
    const cleaned = perms.filter(p => PERMISSIONS.includes(p)); // drop retired perms
    const stripped = cleaned.length !== perms.length;
    if (!missing.length && !stripped) return;
    const updated = cleaned.concat(missing.filter(p => PERMISSIONS.includes(p)));
    _run('UPDATE groups SET permissions=? WHERE id=?', [JSON.stringify(updated), g.id]);
    recomputeGroupMemberPermissions(g.id);
  });
}

function getGroups() {
  return _q('SELECT * FROM groups ORDER BY id').map(g => ({
    id: g.id, key: g.key, label: g.label,
    permissions: _j(g.permissions, []),
    is_protected: !!g.is_protected,
    created_at: g.created_at,
  }));
}

function getUserGroups(userId) {
  return _q(
    'SELECT g.id,g.key,g.label,g.permissions,g.is_protected FROM groups g JOIN user_groups ug ON ug.group_id=g.id WHERE ug.user_id=? ORDER BY g.id',
    [userId]
  ).map(g => ({ id: g.id, key: g.key, label: g.label, permissions: _j(g.permissions, []), is_protected: !!g.is_protected }));
}

function computeGroupsPermissions(groupIds) {
  if (!groupIds || !groupIds.length) return [];
  const set = new Set();
  for (const gid of groupIds) {
    const g = _q1('SELECT permissions FROM groups WHERE id=?', [gid]);
    if (g) _j(g.permissions, []).forEach(p => set.add(p));
  }
  return [...set].filter(p => PERMISSIONS.includes(p));
}

function getUserEffectivePermissions(userId) {
  const groups = getUserGroups(userId);
  const set = new Set();
  groups.forEach(g => g.permissions.forEach(p => set.add(p)));
  return [...set].filter(p => PERMISSIONS.includes(p));
}

function recomputeUserPermissions(userId) {
  const perms = getUserEffectivePermissions(userId);
  _run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(perms), userId]);
  return perms;
}

function recomputeGroupMemberPermissions(groupId) {
  _q('SELECT user_id FROM user_groups WHERE group_id=?', [groupId])
    .forEach(m => recomputeUserPermissions(m.user_id));
}

function setUserGroups(userId, groupIds) {
  _db.transaction(() => {
    _run('DELETE FROM user_groups WHERE user_id=?', [userId]);
    for (const gid of groupIds) {
      _run('INSERT OR IGNORE INTO user_groups (user_id,group_id) VALUES (?,?)', [userId, gid]);
    }
    recomputeUserPermissions(userId);
  })();
}

function createGroup(key, label, permissions) {
  permissions = (permissions || []).filter(p => PERMISSIONS.includes(p));
  _run('INSERT INTO groups (key,label,permissions) VALUES (?,?,?)', [key, label, JSON.stringify(permissions)]);
  return _q1('SELECT * FROM groups WHERE key=?', [key]);
}

function updateGroup(id, label, permissions) {
  permissions = (permissions || []).filter(p => PERMISSIONS.includes(p));
  _run('UPDATE groups SET label=?,permissions=? WHERE id=?', [label, JSON.stringify(permissions), id]);
  recomputeGroupMemberPermissions(id);
}

function deleteGroup(id) {
  const members = _q('SELECT user_id FROM user_groups WHERE group_id=?', [id]);
  _run('DELETE FROM user_groups WHERE group_id=?', [id]);
  _run('DELETE FROM groups WHERE id=?', [id]);
  members.forEach(m => recomputeUserPermissions(m.user_id));
  return members.map(m => m.user_id);
}

// ── Core helpers ──────────────────────────────────────────────────────
function _run(sql, params = []) {
  return _db.prepare(sql).run(...params);
}
function _q(sql, params = []) {
  return _db.prepare(sql).all(...params);
}
function _q1(sql, params = []) {
  return _db.prepare(sql).get(...params) || null;
}
// No-op: better-sqlite3 writes directly to disk on every statement
function _save() {}
function _j(str, def) { try { return JSON.parse(str); } catch(e) { return def; } }

// ── Public API ────────────────────────────────────────────────────────
function query(sql, p=[])  { return _q(sql, p); }
function query1(sql, p=[]) { return _q1(sql, p); }
function run(sql, p=[])    { _run(sql, p); }
function save()             { /* no-op */ }
function runAndSave(sql, p) { _run(sql, p); }

function getSetting(key, def=null) {
  const row = _q1('SELECT value FROM settings WHERE key=?', [key]);
  if (!row) return def;
  return _j(row.value, row.value);
}
function setSetting(key, val) {
  const v = typeof val === 'string' ? val : JSON.stringify(val);
  _run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', [key, v]);
}
function setSettingAndSave(key, val) { setSetting(key, val); }

// ── Photo helpers ─────────────────────────────────────────────────────
function savePhoto(b64, fname) {
  if (!b64 || !b64.startsWith('data:')) return b64;
  const dir = path.join(path.dirname(_dbPath), 'photos');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fname), Buffer.from(b64.split(',')[1], 'base64'));
  return 'photos/' + fname;
}
function getPhotoB64(p) {
  if (!p) return null;
  if (p.startsWith('data:')) return p;
  const photosDir = path.resolve(path.dirname(_dbPath), 'photos');
  const full = path.resolve(path.dirname(_dbPath), p);
  if (!full.startsWith(photosDir + path.sep) && !full.startsWith(photosDir + '/')) return null;
  if (!fs.existsSync(full)) return null;
  const ext = path.extname(full).slice(1).toLowerCase();
  return `data:${ext === 'gif' ? 'image/gif' : 'image/jpeg'};base64,${fs.readFileSync(full).toString('base64')}`;
}
function resolveClientPhoto(photo) {
  if (!photo) return null;
  if (photo.startsWith('data:')) return photo;
  return getPhotoB64(photo);
}

// ── Full data (legacy JSON shape) ─────────────────────────────────────
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
    r.roster_snapshot  = _j(r.roster_snapshot, null);
    r.log_entries = _q('SELECT * FROM log_entries WHERE report_id=? ORDER BY rowid', [r.id]);
    r.log_entries.forEach(function(e) {
      if (e.ua_photo && (typeof e.ua_photo !== 'string' || !e.ua_photo.startsWith('data:'))) {
        e.ua_photo = true;
      }
    });
  });

  const logoP = getSetting('logo_pdec', '');
  const logoW = getSetting('logo_wcs', '');

  const today = new Date().toISOString().slice(0, 10);
  const staffRows = _q('SELECT * FROM staff ORDER BY sort_order, id');
  const passRows  = _q("SELECT * FROM passes ORDER BY CASE status WHEN 'Out' THEN 0 WHEN 'Extended' THEN 1 ELSE 2 END, return_date ASC");
  const choreLog  = _q('SELECT * FROM chore_log WHERE log_date=?', [today]);

  return {
    clients, reports,
    logos:                  { pdec: getPhotoB64(logoP) || null, wcs: getPhotoB64(logoW) || null },
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

// ── Report upsert (wrapped in a transaction) ──────────────────────────
function upsertReport(r) {
  const _do = _db.transaction(() => {
    const now = new Date().toISOString();
    const exists = _q1('SELECT id FROM reports WHERE id=?', [r.id]);
    if (exists) {
      if (r.is_closed && r.roster_snapshot) {
        const existing = _q1('SELECT roster_snapshot FROM reports WHERE id=?', [r.id]);
        if (!existing || !existing.roster_snapshot) {
          _run('UPDATE reports SET roster_snapshot=? WHERE id=?',
            [JSON.stringify(r.roster_snapshot), r.id]);
        }
      }
      _run(`UPDATE reports SET report_date=?,shift=?,mod_name=?,is_closed=?,statuses=?,
        comments=?,last_ua=?,last_room_search=?,issues=?,med_notes=?,updated_at=? WHERE id=?`,
        [r.report_date||'', r.shift||'', r.mod_name||'', r.is_closed?1:0,
         JSON.stringify(r.statuses||{}), JSON.stringify(r.comments||{}),
         JSON.stringify(r.last_ua||{}), JSON.stringify(r.last_room_search||{}),
         JSON.stringify(r.issues||[]), JSON.stringify(r.med_notes||[]), now, r.id]);
      const existingEntries = _q('SELECT id,time,text FROM log_entries WHERE report_id=?', [r.id]);
      const existingIds = existingEntries.map(e => e.id);
      const incomingIds = (r.log_entries||[]).filter(e => e.id).map(e => parseInt(e.id));
      const noIdEntries = (r.log_entries||[]).filter(e => !e.id);
      existingIds.filter(id => !incomingIds.includes(id)).forEach(id => {
        const dbEntry = existingEntries.find(ex => ex.id === id);
        if (!dbEntry) return;
        const matchedByText = noIdEntries.some(e =>
          (e.time||'') === (dbEntry.time||'') && (e.text||'') === (dbEntry.text||'')
        );
        if (!matchedByText) _run('DELETE FROM log_entries WHERE id=?', [id]);
      });
      (r.log_entries||[]).forEach(e => {
        if (e.id && existingIds.includes(parseInt(e.id))) {
          const isSentinel = e.ua_photo === true || e.ua_photo === 1;
          if (isSentinel) {
            _run('UPDATE log_entries SET time=?,text=? WHERE id=?',
              [e.time||'', e.text||'', e.id]);
          } else {
            _run('UPDATE log_entries SET time=?,text=?,ua_photo=? WHERE id=?',
              [e.time||'', e.text||'', e.ua_photo||null, e.id]);
          }
        } else if (!e.id) {
          const dup = existingEntries.find(ex => ex.time===(e.time||'') && ex.text===(e.text||''));
          if (!dup) {
            _run('INSERT INTO log_entries (report_id,time,text,ua_photo) VALUES (?,?,?,?)',
              [r.id, e.time||'', e.text||'', e.ua_photo||null]);
          }
        }
      });
    } else {
      let info;
      if (r.id) {
        info = _run(`INSERT INTO reports (id,report_date,shift,mod_name,is_closed,statuses,comments,
          last_ua,last_room_search,issues,med_notes,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.id, r.report_date||'', r.shift||'', r.mod_name||'', r.is_closed?1:0,
           JSON.stringify(r.statuses||{}), JSON.stringify(r.comments||{}),
           JSON.stringify(r.last_ua||{}), JSON.stringify(r.last_room_search||{}),
           JSON.stringify(r.issues||[]), JSON.stringify(r.med_notes||[]), now, now]);
      } else {
        info = _run(`INSERT INTO reports (report_date,shift,mod_name,is_closed,statuses,comments,
          last_ua,last_room_search,issues,med_notes,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.report_date||'', r.shift||'', r.mod_name||'', r.is_closed?1:0,
           JSON.stringify(r.statuses||{}), JSON.stringify(r.comments||{}),
           JSON.stringify(r.last_ua||{}), JSON.stringify(r.last_room_search||{}),
           JSON.stringify(r.issues||[]), JSON.stringify(r.med_notes||[]), now, now]);
      }
      const useId = r.id || info.lastInsertRowid;
      (r.log_entries||[]).forEach(e => {
        _run('INSERT INTO log_entries (report_id,time,text,ua_photo) VALUES (?,?,?,?)',
          [useId, e.time||'', e.text||'', e.ua_photo||null]);
      });
    }
  });
  _do();
}

// ── Audit Log ─────────────────────────────────────────────────────────
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
  } catch(e) { /* never let audit failure crash the caller */ }
}

function getAuditLog({actionPrefixes, actorId, from, to, search, limit, offset} = {}) {
  const where = [], params = [];
  if (actionPrefixes && actionPrefixes.length > 0) {
    const conditions = actionPrefixes.map(() => 'action LIKE ?').join(' OR ');
    where.push('(' + conditions + ')');
    actionPrefixes.forEach(p => params.push(p + '.%'));
  }
  if (actorId) { where.push('actor_id=?');  params.push(parseInt(actorId)); }
  if (from)    { where.push('ts >= ?');      params.push(from); }
  if (to)      { where.push('ts <= ?');      params.push(to.length === 10 ? to + ' 23:59:59' : to); }
  if (search) {
    const s = '%' + String(search).replace(/[%_]/g, '\\$&') + '%';
    where.push('(actor_name LIKE ? OR action LIKE ? OR target_label LIKE ? OR detail LIKE ?)');
    params.push(s, s, s, s);
  }
  const wc  = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const lim = Math.min(parseInt(limit) || 100, 500);
  const off = parseInt(offset) || 0;
  const countRow = _q1('SELECT COUNT(*) as c FROM audit_log ' + wc, params);
  const rows = _q('SELECT * FROM audit_log ' + wc + ' ORDER BY id DESC LIMIT ? OFFSET ?', [...params, lim, off]);
  return { rows, total: countRow ? countRow.c : 0 };
}

function pruneAuditLog(days) {
  days = days || 365;
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    _run('DELETE FROM audit_log WHERE ts < ?', [cutoff]);
  } catch(e) {}
}

// ── UA Draws ──────────────────────────────────────────────────────────
function createUADraw(drawnById, drawnByName, residents) {
  const r = _run(
    `INSERT INTO ua_draws (drawn_by, drawn_by_name, method, residents) VALUES (?,?,?,?)`,
    [drawnById, drawnByName, 'random', JSON.stringify(residents || [])]
  );
  return getUADraw(r.lastInsertRowid);
}
function getUADraw(id) {
  const row = _q1('SELECT * FROM ua_draws WHERE id=?', [id]);
  if (!row) return null;
  try { row.residents = JSON.parse(row.residents); } catch(e) { row.residents = []; }
  return row;
}
function getUADraws(sinceDate) {
  const rows = _q(
    `SELECT * FROM ua_draws WHERE date(created_at) >= date(?) ORDER BY created_at DESC`,
    [sinceDate]
  );
  return rows.map(r => {
    try { r.residents = JSON.parse(r.residents); } catch(e) { r.residents = []; }
    return r;
  });
}
function getRecentDrawnClientIds(lookbackDays) {
  const since = new Date(Date.now() - (lookbackDays || 30) * 86400000).toISOString().slice(0, 10);
  const rows = _q(`SELECT residents FROM ua_draws WHERE date(created_at) >= date(?)`, [since]);
  const ids = new Set();
  rows.forEach(r => {
    try { JSON.parse(r.residents).forEach(c => { if (c.id) ids.add(c.id); }); } catch(e) {}
  });
  return ids;
}

// ── Broadcasts ────────────────────────────────────────────────────────
function createBroadcast(senderId, senderName, message) {
  const r = _run(
    `INSERT INTO broadcast_messages (sender_id, sender_name, message) VALUES (?,?,?)`,
    [senderId, senderName, message]
  );
  return getBroadcast(r.lastInsertRowid);
}
function getBroadcast(id) {
  return _q1('SELECT * FROM broadcast_messages WHERE id=?', [id]);
}
function getBroadcasts(limitHours) {
  const hours = limitHours || 24;
  return _q(
    `SELECT * FROM broadcast_messages WHERE created_at >= datetime('now', ? || ' hours') ORDER BY created_at DESC`,
    ['-' + hours]
  );
}

module.exports = {
  init, save, query, query1, run, runAndSave,
  getSetting, setSetting, setSettingAndSave,
  getAllData, upsertReport, savePhoto, getPhotoB64,
  DEFAULT_WALK_AREAS, DEFAULT_UA_PANEL,
  PERMISSIONS, ROLE_PRESETS,
  getPermissionProfiles, setPermissionProfiles,
  // Groups
  getGroups, getUserGroups, computeGroupsPermissions,
  getUserEffectivePermissions, recomputeUserPermissions,
  setUserGroups, createGroup, updateGroup, deleteGroup,
  // UA Draws
  createUADraw, getUADraw, getUADraws, getRecentDrawnClientIds,
  // Broadcasts
  createBroadcast, getBroadcast, getBroadcasts,
  auditLog, getAuditLog, pruneAuditLog,
};
