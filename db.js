/**
 * db.js — SQLite layer using better-sqlite3 (native bindings, WAL mode)
 * Writes go directly to disk on every statement — no manual flush needed.
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const migrate    = require('./server/db/migrate');    // schema DDL + column migrations
const connection = require('./server/db/connection'); // better-sqlite3 handle + primitives

let _db     = null;
let _dbPath = null;

// Returns "YYYY-MM-DD HH:MM:SS" in local time — use instead of datetime('now') (UTC).
function nowLocal() {
  const d = new Date(), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

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
  'chores.assign',    // assign chores to residents, manage master chore list
  'chores.log',       // initial / log chore completions
  'passes.edit',      // create / edit / delete passes and pass notice
  'passes.status',    // change pass In/Out status and mark as Returned (check in/out)
  'reminders.view',   // see wellness check and walkthrough reminder banners
  'ua.request',       // flag a resident for UA from the roster
  'ua.acknowledge',   // see the UA alert banner and acknowledge requests
  'ua.delete',        // delete individual UA log entries from the report
  'mail.log',         // log incoming resident mail
  'mail.approve',     // approve logged mail for delivery to resident
  'mail.deliver',     // mark approved mail as delivered to resident
  'mail.delete',      // delete mail log records
  'violations.log',      // log a new violation
  'violations.review',   // review a violation (assign consequence or waive)
  'violations.complete', // mark a consequence as completed
  'violations.delete',   // permanently delete violation records
  'violations.notify_review',    // receive banner when a violation is pending review
  'violations.notify_consequence', // receive banner when a consequence is assigned
  'facility.manage',  // room and roster management
  'admin.users',      // user management
  'admin.settings',   // facility settings write
  'admin.audit',      // view the audit log
  'admin.system',     // access system controls (server restart)
  'mobile.access',    // use the mobile shift interface
  'broadcast.send',   // compose and send announcements to all staff
  'broadcast.receive',// receive announcements in the notification bell
  'ua.draw',          // run the random UA draw
  // ── EHR / HIPAA expansion ───────────────────────────────────────
  'ua.record',           // create / edit a formal UA record (panel results, COC)
  'med.witness',         // record witnessed self-administration doses
  'med.delete',          // delete a med administration entry
  'milestones.edit',     // create / edit program milestones
  'milestones.signoff',  // sign off on a completed milestone (counselor)
  'incidents.log',       // log a behavioral incident report
  'incidents.review',    // supervisor review of an incident
  'incidents.delete',    // delete an incident (admin)
  'consent.manage',      // create / revoke 42 CFR Part 2 consent records
  'disclosures.view',    // view the disclosure audit log
  'records.unlock',      // supervisor override to unlock a record past the 24h immutability window
  'groups.view',         // view group sessions and attendance records
  'groups.log',          // log group sessions and mark attendance
  // ── Structured Clinical Lite ────────────────────────────────────
  'clinical.notes',         // create / edit clinical progress notes
  'clinical.treatment',     // create / edit treatment plans
  'clinical.assessments',   // create / edit clinical assessments
  'clinical.groups',        // create / edit group session notes
  'clinical.discharge',     // create / edit discharge summaries
];

const ROLE_PRESETS = {
  pa: [
    'reports.create', 'reports.close', 'log.add', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.assign', 'chores.log', 'passes.status',
    'reminders.view', 'ua.acknowledge', 'mail.log', 'mail.deliver', 'violations.log',
    'violations.notify_consequence', 'mobile.access',
    'med.witness', 'incidents.log',
    'groups.view', 'groups.log',
  ],
  supervisor: [
    'reports.create', 'reports.close', 'log.add', 'log.delete', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.assign', 'chores.log', 'passes.edit', 'passes.status',
    'reminders.view', 'ua.request', 'ua.acknowledge', 'mail.log', 'mail.deliver',
    'violations.log', 'violations.review', 'violations.complete',
    'violations.notify_review', 'violations.notify_consequence',
    'broadcast.send', 'broadcast.receive', 'ua.draw',
    'mobile.access',
    'ua.record', 'med.witness', 'med.delete',
    'milestones.edit', 'incidents.log', 'incidents.review',
    'groups.view', 'groups.log',
    'clinical.notes', 'clinical.treatment', 'clinical.assessments', 'clinical.groups', 'clinical.discharge',
  ],
  admin: [
    'reports.create', 'reports.close', 'reports.delete',
    'log.add', 'log.delete', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.assign', 'chores.log', 'passes.edit', 'passes.status',
    'ua.request', 'ua.delete', 'mail.log', 'mail.approve', 'mail.deliver', 'mail.delete',
    'violations.log', 'violations.review', 'violations.complete', 'violations.delete',
    'violations.notify_review', 'violations.notify_consequence',
    'broadcast.send', 'broadcast.receive', 'ua.draw',
    'facility.manage', 'admin.users', 'admin.settings', 'admin.audit', 'admin.system',
    'mobile.access',
    'ua.record', 'med.witness', 'med.delete',
    'milestones.edit', 'milestones.signoff',
    'incidents.log', 'incidents.review', 'incidents.delete',
    'consent.manage', 'disclosures.view', 'records.unlock',
    'groups.view', 'groups.log',
    'clinical.notes', 'clinical.treatment', 'clinical.assessments', 'clinical.groups', 'clinical.discharge',
  ],
  case_manager: [
    'residents.edit', 'staff.edit', 'passes.edit',
    'ua.request', 'ua.delete', 'mail.approve',
    'violations.notify_review',
    'broadcast.send', 'broadcast.receive',
    'mobile.access',
    'milestones.edit', 'milestones.signoff', 'consent.manage',
    'groups.view',
    'clinical.notes', 'clinical.treatment', 'clinical.assessments', 'clinical.groups', 'clinical.discharge',
  ],
};

// ── Init (synchronous) ───────────────────────────────────────────────
function init(dbPath) {
  _dbPath = dbPath;
  const isNew = !fs.existsSync(dbPath);
  _db = connection.open(dbPath);   // owns new Database() + WAL/FK pragmas
  console.log('  DB:', isNew ? 'Created' : 'Loaded', path.basename(dbPath));

  migrate.createSchema(_db);
  _applyClinicalLiteMigration();   // Structured Clinical Lite — idempotent (CREATE IF NOT EXISTS)
  migrate.runColumnMigrations(_db); // additive ALTER-TABLE column migrations (see server/db/migrate.js)
  _seedDefaults();
  _seedExistingUserPermissions();
  _migratePermissions();
  const _bootNewPerms = _migrateProfiles();
  _seedGroups();
  _migrateUserGroups();
  _migrateGroups(_bootNewPerms);
  _createSyncLayer();              // sync_outbox + triggers (multi-facility Phase 1)
  pruneAuditLog(365);
  // Lock any clinical records past their 24h grace window (boot-time sweep)
  try { runLockSweep(); } catch(e) {}
}

function _hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pw, salt, 600000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function _defaultProfiles() {
  return [
    { key: 'pa',           label: 'Program Assistant', permissions: ROLE_PRESETS.pa.slice() },
    { key: 'supervisor',   label: 'Supervisor',        permissions: ROLE_PRESETS.supervisor.slice() },
    { key: 'admin',        label: 'Administrator',     permissions: ROLE_PRESETS.admin.slice() },
    { key: 'case_manager', label: 'Case Manager',      permissions: ROLE_PRESETS.case_manager.slice() },
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
    facility_name:          'OpsPoint',
    wellness_interval_mins: '120',
    walk_interval_mins:     '240',
    walk_areas:             JSON.stringify(DEFAULT_WALK_AREAS),
    ua_panel:               JSON.stringify(DEFAULT_UA_PANEL),
    wellness_schedule:      '[]',
    walk_schedule:          '[]',
    active_report_id:       'null',
    master_chores:          '[]',
    master_groups:          '[]',
    pass_notice:            '""',
    staff_categories:       JSON.stringify(['Director','Case Manager','Program Assistant','Other']),
    shift_day_start:        '07:00',
    shift_swing_start:      '15:00',
    shift_grave_start:      '23:00',
    ui_visibility:          JSON.stringify({tabs:{staff:true,chores:true,passes:true,caseloads:true,mail:true,reports:true,violations:true,ua_records:true,med_log:true,milestones:true,incidents:true},buttons:{wellness:true,walkthrough:true}}),
    program_tracks:         JSON.stringify(['SUD Residential','Re-entry','Transitional','Sober Living']),
    program_phases:         JSON.stringify([
      { key:'orientation', label:'Orientation',  objectives:['Complete intake paperwork','Tour facility','Sign program agreement'] },
      { key:'phase1',      label:'Phase 1',      objectives:['Attend daily groups','Establish routine'] },
      { key:'phase2',      label:'Phase 2',      objectives:['Begin step work','Obtain ID / vital docs'] },
      { key:'phase3',      label:'Phase 3',      objectives:['Employment / school enrollment','Save 30 days of expenses'] },
      { key:'aftercare',   label:'Aftercare',    objectives:['Identify aftercare provider','Schedule discharge meeting'] },
    ]),
    incident_notifications: JSON.stringify({
      low:      [],
      medium:   ['supervisor'],
      high:     ['supervisor','case_manager'],
      critical: ['supervisor','case_manager','licensing','guardian'],
    }),
    session_idle_mins:      '30',  // HIPAA technical safeguard — minutes of inactivity before forced logout
    update_manifest_url:    'https://github.com/harrisb415/opspoint-releases/releases/latest/download/update-manifest.json',
    update_auto_check:      'true', // check for updates on boot + daily; never auto-APPLY
    // ── Central / HQ link (multi-facility, Phase 0) ───────────────────
    central_url:            '',      // HQ server base URL (empty = standalone)
    central_facility_id:    '',      // this facility's UUID, issued by HQ at enrollment
    central_api_key:        '',      // per-facility enrollment key (server-only; never sent to clients)
    central_insecure_tls:   'false', // allow self-signed HQ cert (trusted networks only)
    central_last_checkin:   '',      // local timestamp of last successful HQ check-in
    central_last_status:    '',      // connected | unreachable | rejected
    central_manages_users:  'false', // opt-in: accept HQ-managed user accounts (Phase 2b)
    central_users_last_pull:'',      // local timestamp of last managed-user pull
    central_users_count:    '0',     // how many managed users currently provisioned
    central_target_version: '',      // version HQ recommends the fleet run (Phase 3)
    central_auto_update:    'false', // opt-in: auto-apply HQ rollout directives (Phase 5)
    central_update_window:  '',      // 'HH:MM-HH:MM' local; empty = anytime (Phase 5)
  };
  for (const [k, v] of Object.entries(defs)) {
    if (!_q1('SELECT key FROM settings WHERE key=?', [k]))
      _run('INSERT INTO settings (key,value) VALUES (?,?)', [k, v]);
  }
  // Self-correct an early default that pointed at the PRIVATE source repo — the
  // updater fetches with no token, so the manifest must live on the public
  // releases repo. Safe/idempotent; only rewrites the known-bad value.
  {
    const _mu = _q1('SELECT value FROM settings WHERE key=?', ['update_manifest_url']);
    if (_mu && /OpsPoint-FULL-HIPAA/.test(_mu.value))
      _run('UPDATE settings SET value=? WHERE key=?', [defs.update_manifest_url, 'update_manifest_url']);
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
    const adminPw=_randPw(), supPw=_randPw(), paPw=_randPw();
    const a=_hashPw(adminPw), s=_hashPw(supPw), p=_hashPw(paPw);
    console.log('\n  ╔══════════════════════════════════════════════╗');
    console.log('  ║  FIRST-RUN CREDENTIALS (change on login)     ║');
    console.log('  ╠══════════════════════════════════════════════╣');
    console.log('  ║  admin      / ' + adminPw.padEnd(32) + '║');
    console.log('  ║  supervisor / ' + supPw.padEnd(32) + '║');
    console.log('  ║  pa         / ' + paPw.padEnd(32) + '║');
    console.log('  ╚══════════════════════════════════════════════╝\n');
    _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES ('admin','Administrator','admin',?,?,1,?,1)`,[a.hash,a.salt,JSON.stringify(ROLE_PRESETS.admin)]);
    _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions) VALUES ('supervisor','Supervisor','supervisor',?,?,1,?)`,[s.hash,s.salt,JSON.stringify(ROLE_PRESETS.supervisor)]);
    _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions) VALUES ('pa','Program Assistant','pa',?,?,1,?)`,[p.hash,p.salt,JSON.stringify(ROLE_PRESETS.pa)]);
  }
}

// Seed permissions for existing users that predate the permission system
function _seedExistingUserPermissions() {
  const users = _q('SELECT id, role FROM users WHERE permissions IS NULL');
  users.forEach(u => {
    const perms = ROLE_PRESETS[u.role] || ROLE_PRESETS.pa;
    _run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(perms), u.id]);
  });
}

// Strip any retired permissions (no longer in PERMISSIONS) from user rows.
// New permissions propagate via _migrateGroups — no need to enumerate them here.
function _migratePermissions() {
  _q('SELECT id, permissions FROM users WHERE permissions IS NOT NULL').forEach(u => {
    try {
      const perms   = JSON.parse(u.permissions || '[]');
      const cleaned = perms.filter(p => PERMISSIONS.includes(p));
      if (cleaned.length !== perms.length)
        _run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(cleaned), u.id]);
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
  return newPerms; // pass to _migrateGroups so it uses the same delta
}

// ── Groups ────────────────────────────────────────────────────────────
function _seedGroups() {
  const existing = _q1('SELECT COUNT(*) as c FROM groups');
  if (existing && existing.c > 0) return;
  const seeds = [
    { key: 'pa',           label: 'Program Assistant', permissions: ROLE_PRESETS.pa,           is_protected: 0 },
    { key: 'supervisor',   label: 'Supervisor',         permissions: ROLE_PRESETS.supervisor,    is_protected: 0 },
    { key: 'admin',        label: 'Administrator',      permissions: ROLE_PRESETS.admin,         is_protected: 1 },
    { key: 'case_manager', label: 'Case Manager',       permissions: ROLE_PRESETS.case_manager,  is_protected: 0 },
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
function _migrateGroups(newPerms = []) {
  const groups = _q('SELECT * FROM groups');
  groups.forEach(g => {
    const perms   = _j(g.permissions, []);
    const preset  = ROLE_PRESETS[g.key];
    // Only add permissions that are NEWLY introduced in this boot (not previously known).
    // Never add back permissions that were deliberately removed from a group.
    const toAdd   = preset ? newPerms.filter(p => preset.includes(p) && !perms.includes(p)) : [];
    const cleaned = perms.filter(p => PERMISSIONS.includes(p)); // drop retired perms
    const stripped = cleaned.length !== perms.length;
    if (!toAdd.length && !stripped) return;
    const updated = cleaned.concat(toAdd);
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
// Primitives delegate to server/db/connection.js (single source of SQL truth).
function _run(sql, params = []) { return connection.run(sql, params); }
function _q(sql, params = [])   { return connection.query(sql, params); }
function _q1(sql, params = [])  { return connection.query1(sql, params); }
// No-op: better-sqlite3 writes directly to disk on every statement
function _save() {}
function _j(str, def) { try { return JSON.parse(str); } catch(e) { return def; } }

// ── Public API ────────────────────────────────────────────────────────
function query(sql, p=[])  { return _q(sql, p); }
function query1(sql, p=[]) { return _q1(sql, p); }
function run(sql, p=[])    { return _run(sql, p); }
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
// Permissions that grant access to clinical / treatment-record fields.
// A user without ANY of these is non-clinical (PA, shift lead, front desk) and
// must not see treatment narratives, medical observations, or intake details.
const CLINICAL_PERMS = [
  'ua.record', 'med.witness',
  'milestones.edit', 'milestones.signoff',
  'incidents.log',   'incidents.review',
  'consent.manage',  'disclosures.view',
];

function _hasClinical(perms) {
  if (!Array.isArray(perms)) return false;
  return CLINICAL_PERMS.some(p => perms.includes(p));
}

function getAllData(perms) {
  const isClinical = _hasClinical(perms);

  const clients = _q('SELECT * FROM clients ORDER BY sort_order, CAST(room AS INTEGER), room');
  clients.forEach(c => {
    c.is_special = !!c.is_special; c.is_active = !!c.is_active;
    c.photo = resolveClientPhoto(c.photo);
    c.emergency_contacts = _j(c.emergency_contacts, []);
    // Strip treatment-record fields for non-clinical staff (HIPAA minimum necessary)
    if (!isClinical) {
      c.intake_notes    = '';
      c.referral_source = '';
      c.program_track   = '';
    }
  });

  const reports = _q('SELECT * FROM reports ORDER BY created_at');
  reports.forEach(r => {
    r.is_closed        = !!r.is_closed;
    r.statuses         = _j(r.statuses, {});
    r.comments         = _j(r.comments, {});
    r.last_ua          = _j(r.last_ua, {});
    r.last_room_search = _j(r.last_room_search, {});
    r.issues           = _j(r.issues, []);
    r.med_notes        = isClinical ? _j(r.med_notes, []) : [];
    r.roster_snapshot  = _j(r.roster_snapshot, null);
    r.log_entries = _q('SELECT * FROM log_entries WHERE report_id=? ORDER BY rowid', [r.id]);
    r.log_entries.forEach(function(e) {
      if (e.ua_photo && (typeof e.ua_photo !== 'string' || !e.ua_photo.startsWith('data:'))) {
        e.ua_photo = true;
      }
    });
  });

  const today = new Date().toISOString().slice(0, 10);
  const staffRows = _q('SELECT * FROM staff ORDER BY sort_order, id');
  const passRows  = _q("SELECT * FROM passes ORDER BY CASE status WHEN 'Out' THEN 0 WHEN 'Extended' THEN 1 ELSE 2 END, return_date ASC");
  const choreLog  = _q('SELECT * FROM chore_log WHERE log_date=?', [today]);

  return {
    clients, reports,
    facility_name:          getSetting('facility_name',          'OpsPoint'),
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
    master_groups:          getSetting('master_groups',          []),
    pass_notice:            getSetting('pass_notice',            ''),
    staff_categories:       getSetting('staff_categories',       ['Director','Case Manager','Program Assistant','Other']),
    program_tracks:         getSetting('program_tracks',         ['SUD Residential','Re-entry','Transitional','Sober Living']),
    program_phases:         getSetting('program_phases',         []),
    incident_notifications: getSetting('incident_notifications', { low:[], medium:['supervisor'], high:['supervisor','case_manager'], critical:['supervisor','case_manager','licensing','guardian'] }),
    session_idle_mins:      parseInt(getSetting('session_idle_mins', 30)) || 30,
    ui_visibility:          getSetting('ui_visibility',          {}),
  };
}

// ── Group sessions + attendance ───────────────────────────────────────
function getGroupSessions({ date, from, to }) {
  if (from && to) {
    return _q('SELECT * FROM group_sessions WHERE session_date>=? AND session_date<=? ORDER BY session_date, id', [from, to]);
  }
  const d = date || new Date().toISOString().slice(0, 10);
  return _q('SELECT * FROM group_sessions WHERE session_date=? ORDER BY id', [d]);
}

function createGroupSession({ session_date, group_name, time_of_day, facilitator, notes, created_by_id, created_by_name }) {
  _run(`INSERT INTO group_sessions (session_date,group_name,time_of_day,facilitator,notes,created_by_id,created_by_name,created_at)
        VALUES (?,?,?,?,?,?,?,?)`,
    [session_date, group_name, time_of_day||'', facilitator||'', notes||'', created_by_id||null, created_by_name||'', nowLocal()]);
  const row = _q1('SELECT last_insert_rowid() AS id');
  return row ? _q1('SELECT * FROM group_sessions WHERE id=?', [row.id]) : null;
}

function deleteGroupSession(id) {
  _run('DELETE FROM group_sessions WHERE id=?', [id]);
}

function getGroupAttendance(session_id) {
  return _q('SELECT * FROM group_attendance WHERE session_id=? ORDER BY room, client_name', [session_id]);
}

function saveGroupAttendance(session_id, attendees) {
  // attendees: [{client_id, client_name, room, present, notes}]
  attendees.forEach(a => {
    _run(`INSERT INTO group_attendance (session_id,client_id,client_name,room,present,notes)
          VALUES (?,?,?,?,?,?)
          ON CONFLICT(session_id,client_id) DO UPDATE SET
            present=excluded.present, notes=excluded.notes,
            client_name=excluded.client_name, room=excluded.room`,
      [session_id, a.client_id, a.client_name||'', a.room||'', a.present?1:0, a.notes||'']);
  });
}

// ── Clinical record helpers (Phases 2-7) ──────────────────────────────
// All clinical tables share the locked_at immutability pattern and audit-traced reads.
const CLINICAL_TABLES = ['ua_records','med_administration_log','milestones','incidents'];

function _parseJsonFields(row, fields) {
  if (!row) return row;
  fields.forEach(f => { if (row[f] != null) row[f] = _j(row[f], f === 'panel_results' ? {} : []); });
  return row;
}

function isRecordLocked(table, id) {
  if (!CLINICAL_TABLES.includes(table)) return false;
  const row = _q1(`SELECT locked_at FROM ${table} WHERE id=?`, [id]);
  return !!(row && row.locked_at);
}

function unlockRecord(table, id, by, reason) {
  if (!CLINICAL_TABLES.includes(table)) throw new Error('Invalid table');
  _run(`UPDATE ${table} SET locked_at=NULL, unlocked_by=?, unlocked_at=?, unlock_reason=? WHERE id=?`,
    [String(by||''), nowLocal(), String(reason||''), id]);
}

// Scheduled job — lock any clinical record whose 24h grace period has elapsed.
// Called at boot and every hour.
function runLockSweep() {
  let total = 0;
  CLINICAL_TABLES.forEach(t => {
    try {
      const r = _run(
        `UPDATE ${t} SET locked_at=?
         WHERE locked_at IS NULL AND created_at < datetime('now','-24 hours')`,
        [nowLocal()]
      );
      total += r.changes || 0;
    } catch(e) {}
  });
  return total;
}

// ── UA Records ────────────────────────────────────────────────────────
function createUARecord(rec) {
  const r = _run(
    `INSERT INTO ua_records
     (client_id,client_name,room,ua_request_id,report_id,log_entry_id,tested_at,
      witnessed_by_id,witnessed_by_name,collection_method,reason,result,panel_results,
      chain_of_custody,photo,notes,created_by_id,created_by_name,is_interview)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      rec.client_id||0, rec.client_name||'', rec.room||'',
      rec.ua_request_id||null, rec.report_id||null,
      rec.log_entry_id||null,
      rec.tested_at,
      rec.witnessed_by_id, rec.witnessed_by_name||'',
      rec.collection_method||'observed',
      rec.reason||'',
      rec.result||'pending',
      JSON.stringify(rec.panel_results||{}),
      rec.chain_of_custody||'', rec.photo||null, rec.notes||'',
      rec.created_by_id, rec.created_by_name||'',
      rec.is_interview ? 1 : 0,
    ]
  );
  return getUARecord(r.lastInsertRowid);
}
// Join log_entries so callers can tell whether the linked log entry has a photo
const _UA_SELECT = `
  SELECT ur.*,
    CASE WHEN le.ua_photo IS NOT NULL THEN 1 ELSE 0 END AS has_log_photo
  FROM ua_records ur
  LEFT JOIN log_entries le ON le.id = ur.log_entry_id`;
function getUARecord(id) {
  return _parseJsonFields(_q1(_UA_SELECT + ' WHERE ur.id=?', [id]), ['panel_results']);
}
function getUARecords(filter) {
  filter = filter || {};
  let sql = _UA_SELECT + ' WHERE 1=1';
  const p = [];
  if (filter.client_id) { sql += ' AND ur.client_id=?'; p.push(filter.client_id); }
  if (filter.result)    { sql += ' AND ur.result=?';    p.push(filter.result); }
  if (filter.from)      { sql += ' AND ur.tested_at >= ?'; p.push(filter.from); }
  if (filter.to)        { sql += ' AND ur.tested_at <= ?'; p.push(filter.to); }
  sql += ' ORDER BY ur.tested_at DESC, ur.id DESC LIMIT 500';
  return _q(sql, p).map(r => _parseJsonFields(r, ['panel_results']));
}
function updateUARecord(id, patch) {
  const fields = [], vals = [];
  ['tested_at','collection_method','result','chain_of_custody','notes','photo']
    .forEach(k => { if (patch[k] !== undefined) { fields.push(`${k}=?`); vals.push(patch[k]); } });
  if (patch.panel_results !== undefined) { fields.push('panel_results=?'); vals.push(JSON.stringify(patch.panel_results||{})); }
  if (!fields.length) return getUARecord(id);
  vals.push(id);
  _run(`UPDATE ua_records SET ${fields.join(',')} WHERE id=?`, vals);
  return getUARecord(id);
}
function deleteUARecord(id) { _run('DELETE FROM ua_records WHERE id=?', [id]); }

// ── Med Administration Log ────────────────────────────────────────────
function createMedLog(rec) {
  const r = _run(
    `INSERT INTO med_administration_log
     (client_id,client_name,room,report_id,medication,dose,administered_at,
      witnessed_by_id,witnessed_by_name,notes,created_by_id,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rec.client_id, rec.client_name||'', rec.room||'', rec.report_id||null,
     rec.medication||'', rec.dose||'', rec.administered_at,
     rec.witnessed_by_id, rec.witnessed_by_name||'', rec.notes||'',
     rec.created_by_id, rec.created_by_name||'']
  );
  return _q1('SELECT * FROM med_administration_log WHERE id=?', [r.lastInsertRowid]);
}
function getMedLog(filter) {
  filter = filter || {};
  let sql = 'SELECT * FROM med_administration_log WHERE 1=1';
  const p = [];
  if (filter.client_id) { sql += ' AND client_id=?'; p.push(filter.client_id); }
  if (filter.report_id) { sql += ' AND report_id=?'; p.push(filter.report_id); }
  if (filter.from)      { sql += ' AND administered_at >= ?'; p.push(filter.from); }
  sql += ' ORDER BY administered_at DESC, id DESC LIMIT 1000';
  return _q(sql, p);
}
function updateMedLog(id, patch) {
  const fields = [], vals = [];
  ['medication','dose','administered_at','notes']
    .forEach(k => { if (patch[k] !== undefined) { fields.push(`${k}=?`); vals.push(patch[k]); } });
  if (!fields.length) return null;
  vals.push(id);
  _run(`UPDATE med_administration_log SET ${fields.join(',')} WHERE id=?`, vals);
  return _q1('SELECT * FROM med_administration_log WHERE id=?', [id]);
}
function deleteMedLog(id) { _run('DELETE FROM med_administration_log WHERE id=?', [id]); }

// ── Milestones ────────────────────────────────────────────────────────
function createMilestone(rec) {
  const r = _run(
    `INSERT INTO milestones
     (client_id,client_name,phase,objective,target_date,status,notes,treatment_plan_id,goal_id,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [rec.client_id, rec.client_name||'', rec.phase||'', rec.objective||'',
     rec.target_date||null, rec.status||'in_progress', rec.notes||'',
     rec.treatment_plan_id||null, rec.goal_id||null, rec.created_by_name||'']
  );
  return _q1('SELECT * FROM milestones WHERE id=?', [r.lastInsertRowid]);
}
function getMilestones(filter) {
  filter = filter || {};
  let sql = 'SELECT * FROM milestones WHERE 1=1';
  const p = [];
  if (filter.client_id) { sql += ' AND client_id=?'; p.push(filter.client_id); }
  if (filter.status)    { sql += ' AND status=?';    p.push(filter.status); }
  sql += ' ORDER BY client_id, phase, id DESC';
  return _q(sql, p);
}
function updateMilestone(id, patch) {
  const fields = [], vals = [];
  ['phase','objective','target_date','completion_date','status','notes','treatment_plan_id','goal_id']
    .forEach(k => { if (patch[k] !== undefined) { fields.push(`${k}=?`); vals.push(patch[k]); } });
  if (!fields.length) return null;
  vals.push(id);
  _run(`UPDATE milestones SET ${fields.join(',')} WHERE id=?`, vals);
  return _q1('SELECT * FROM milestones WHERE id=?', [id]);
}
function signoffMilestone(id, counselorId, counselorName) {
  _run(`UPDATE milestones SET counselor_id=?, counselor_name=?,
        signed_off_at=?, status='completed',
        completion_date=COALESCE(completion_date, date('now'))
        WHERE id=?`,
       [counselorId, counselorName||'', nowLocal(), id]);
  return _q1('SELECT * FROM milestones WHERE id=?', [id]);
}
function deleteMilestone(id) { _run('DELETE FROM milestones WHERE id=?', [id]); }

// ── Incidents ─────────────────────────────────────────────────────────
function createIncident(rec) {
  const r = _run(
    `INSERT INTO incidents
     (client_id,client_name,room,incident_date,incident_time,narrative,
      severity,corrective_action,notifications_required,notifications_sent,
      logged_by_id,logged_by_name,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rec.client_id, rec.client_name||'', rec.room||'',
     rec.incident_date, rec.incident_time||'',
     rec.narrative||'', rec.severity||'low', rec.corrective_action||'',
     JSON.stringify(rec.notifications_required||[]),
     JSON.stringify(rec.notifications_sent||[]),
     rec.logged_by_id, rec.logged_by_name||'',
     'open']
  );
  return getIncident(r.lastInsertRowid);
}
function getIncident(id) {
  return _parseJsonFields(_q1('SELECT * FROM incidents WHERE id=?', [id]),
    ['notifications_required','notifications_sent']);
}
function getIncidents(filter) {
  filter = filter || {};
  let sql = 'SELECT * FROM incidents WHERE 1=1';
  const p = [];
  if (filter.client_id) { sql += ' AND client_id=?'; p.push(filter.client_id); }
  if (filter.severity)  { sql += ' AND severity=?';  p.push(filter.severity); }
  if (filter.status)    { sql += ' AND status=?';    p.push(filter.status); }
  sql += ' ORDER BY incident_date DESC, id DESC LIMIT 500';
  return _q(sql, p).map(r => _parseJsonFields(r, ['notifications_required','notifications_sent']));
}
function updateIncident(id, patch) {
  const fields = [], vals = [];
  ['incident_date','incident_time','narrative','severity','corrective_action']
    .forEach(k => { if (patch[k] !== undefined) { fields.push(`${k}=?`); vals.push(patch[k]); } });
  if (patch.notifications_required !== undefined) {
    fields.push('notifications_required=?'); vals.push(JSON.stringify(patch.notifications_required||[]));
  }
  if (patch.notifications_sent !== undefined) {
    fields.push('notifications_sent=?'); vals.push(JSON.stringify(patch.notifications_sent||[]));
  }
  if (!fields.length) return getIncident(id);
  vals.push(id);
  _run(`UPDATE incidents SET ${fields.join(',')} WHERE id=?`, vals);
  return getIncident(id);
}
function reviewIncident(id, supervisorId, supervisorName, reviewNotes, newStatus) {
  _run(`UPDATE incidents SET supervisor_id=?, supervisor_name=?,
        reviewed_at=?, review_notes=?, status=? WHERE id=?`,
       [supervisorId, supervisorName||'', nowLocal(), reviewNotes||'', newStatus||'reviewed', id]);
  return getIncident(id);
}
function deleteIncident(id) { _run('DELETE FROM incidents WHERE id=?', [id]); }

// ── Discharge Records ─────────────────────────────────────────────────
function createDischargeRecord(rec) {
  const r = _run(
    `INSERT INTO discharge_records
     (client_id,client_name,room,program_track,intake_date,discharge_date,
      days_in_program,reason,narrative,aftercare_plan,referrals_made,
      created_by_id,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rec.client_id, rec.client_name||'', rec.room||'', rec.program_track||'',
     rec.intake_date||null, rec.discharge_date,
     parseInt(rec.days_in_program||0),
     rec.reason||'', rec.narrative||'', rec.aftercare_plan||'',
     JSON.stringify(rec.referrals_made||[]),
     rec.created_by_id, rec.created_by_name||'']
  );
  return getDischargeRecord(r.lastInsertRowid);
}
function getDischargeRecord(id) {
  const row = _q1('SELECT * FROM discharge_records WHERE id=?', [id]);
  if (row) row.referrals_made = _j(row.referrals_made, []);
  return row;
}
function getDischargeRecords(filter) {
  filter = filter || {};
  let sql = 'SELECT * FROM discharge_records WHERE 1=1';
  const p = [];
  if (filter.client_id) { sql += ' AND client_id=?'; p.push(filter.client_id); }
  sql += ' ORDER BY discharge_date DESC, id DESC';
  return _q(sql, p).map(r => ({ ...r, referrals_made: _j(r.referrals_made, []) }));
}

// ── 42 CFR Part 2 Consent Records ─────────────────────────────────────
function createConsentRecord(rec) {
  const r = _run(
    `INSERT INTO consent_records
     (client_id,program_name,recipient_name,recipient_org,purpose,information_type,
      effective_date,expiration_date,signature_on_file,created_by_id,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [rec.client_id, rec.program_name||'', rec.recipient_name||'', rec.recipient_org||'',
     rec.purpose||'', rec.information_type||'all',
     rec.effective_date, rec.expiration_date||null,
     rec.signature_on_file?1:0,
     rec.created_by_id, rec.created_by_name||'']
  );
  return _q1('SELECT * FROM consent_records WHERE id=?', [r.lastInsertRowid]);
}
function getConsentRecord(id) { return _q1('SELECT * FROM consent_records WHERE id=?', [id]); }
function getConsentRecords(clientId) {
  return _q('SELECT * FROM consent_records WHERE client_id=? ORDER BY effective_date DESC, id DESC', [clientId]);
}
function revokeConsent(id, by) {
  _run(`UPDATE consent_records SET revoked=1, revoked_at=?, revoked_by=? WHERE id=?`,
       [nowLocal(), String(by||''), id]);
  return _q1('SELECT * FROM consent_records WHERE id=?', [id]);
}
// Returns the active consent that covers a (client, informationType) pair, or null if blocked.
function findActiveConsent(clientId, informationType) {
  const now = new Date().toISOString().slice(0,10);
  const rows = _q(
    `SELECT * FROM consent_records
     WHERE client_id=? AND revoked=0
       AND effective_date <= ?
       AND (expiration_date IS NULL OR expiration_date >= ?)
       AND (information_type='all' OR information_type=?)
     ORDER BY id DESC LIMIT 1`,
    [clientId, now, now, informationType]
  );
  return rows[0] || null;
}

// ── Disclosures ───────────────────────────────────────────────────────
function logDisclosure(rec) {
  const r = _run(
    `INSERT INTO disclosures
     (client_id,consent_id,recipient,information_type,disclosed_by_id,disclosed_by_name,method,notes)
     VALUES (?,?,?,?,?,?,?,?)`,
    [rec.client_id, rec.consent_id||null,
     rec.recipient||'', rec.information_type||'',
     rec.disclosed_by_id, rec.disclosed_by_name||'',
     rec.method||'', rec.notes||'']
  );
  return _q1('SELECT * FROM disclosures WHERE id=?', [r.lastInsertRowid]);
}
function getDisclosures(clientId) {
  return _q('SELECT * FROM disclosures WHERE client_id=? ORDER BY disclosed_at DESC, id DESC', [clientId]);
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
      `INSERT INTO audit_log (ts,actor_id,actor_name,ip,action,target_type,target_id,target_label,detail) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        nowLocal(),                 // local time, not UTC datetime('now')
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
    // Local-time cutoff to match the local-time ts written by auditLog().
    const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000), p = n => String(n).padStart(2, '0');
    const cutoff = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

// ════════════════════════════════════════════════════════════════════════
// Structured Clinical Lite — clinical_notes, treatment_plans, assessments,
// group_notes (+attendees), discharge_summaries.
//
// Helpers accept an OPTIONAL `db` (a better-sqlite3 instance) that defaults to
// the module connection. Server code calls them param-less; unit tests inject
// an isolated in-memory database seeded with migrations/001_clinical_lite.sql.
//
// Constraints honoured here:
//   • synchronous (no async) — matches the rest of this file
//   • every create/update/sign/delete writes an audit_log row + calls save()
//   • goals (treatment_plans) and content (assessments) are serialised to JSON
//     on write and returned AS-IS (routes parse) per spec
//   • NO medications / e-prescribe / claims / labs anywhere
// ════════════════════════════════════════════════════════════════════════

// Apply the clinical-lite migration file against a connection. Idempotent.
function _applyClinicalLiteMigration(db = _db) {
  const file = path.join(__dirname, 'migrations', '001_clinical_lite.sql');
  try {
    if (fs.existsSync(file)) db.exec(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('  clinical-lite migration failed:', e.message); }
}

// Write an audit row using the EXISTING audit_log schema so clinical activity
// shows up in the same audit viewer as everything else. Never throws.
function _clinicalAudit(db, userId, action, table, recordId, detail) {
  try {
    let name = '';
    try {
      const u = db.prepare('SELECT display_name, username FROM users WHERE id=?').get(userId);
      if (u) name = u.display_name || u.username || '';
    } catch (e) { /* users table may be absent in isolated test dbs */ }
    db.prepare(
      `INSERT INTO audit_log (ts,actor_id,actor_name,ip,action,target_type,target_id,target_label,detail)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      nowLocal(), userId || null, String(name).slice(0, 100), '',
      String(action), String(table).slice(0, 50),
      recordId != null ? String(recordId) : '', '',
      (detail && typeof detail === 'object') ? JSON.stringify(detail).slice(0, 2000) : String(detail || '').slice(0, 2000)
    );
  } catch (e) { /* never let an audit failure crash the caller */ }
}

// Stable short id for treatment-plan goals so milestones can reference a goal
// even as the goals array is edited/reordered.
function _genId() { return crypto.randomBytes(8).toString('hex'); }

// Ensure every goal in a treatment plan carries a stable `id` (assign on write
// if missing). Milestones link to a goal via (treatment_plan_id, goal_id).
function _ensureGoalIds(fields) {
  if (!fields || !Array.isArray(fields.goals)) return fields;
  return {
    ...fields,
    goals: fields.goals.map(g => (g && typeof g === 'object') ? { ...g, id: g.id || _genId() } : g),
  };
}

// Generic CRUD factory for the single-table clinical entities.
function _makeClinical(table, opts) {
  const { jsonFields = [], createCols, updateCols, signFinal = true, dateCol, onWrite } = opts;
  const order = dateCol ? `ORDER BY ${dateCol} DESC, id DESC` : 'ORDER BY id DESC';

  function _ser(fields) {
    const out = { ...fields };
    jsonFields.forEach(f => {
      if (out[f] !== undefined) {
        const fallback = (f === 'content') ? {} : [];
        out[f] = JSON.stringify(out[f] == null ? fallback : out[f]);
      }
    });
    return out;
  }
  function getById(db = _db, id) {
    return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) || null;
  }
  function getAll(db = _db, clientId) {
    if (clientId != null)
      return db.prepare(`SELECT * FROM ${table} WHERE client_id=? ${order}`).all(clientId);
    return db.prepare(`SELECT * FROM ${table} ${order}`).all();
  }
  function getByClient(db = _db, clientId) {
    return db.prepare(`SELECT * FROM ${table} WHERE client_id=? ${order}`).all(clientId);
  }
  function create(db = _db, fields = {}) {
    if (onWrite) fields = onWrite(fields);
    const f    = _ser(fields);
    const cols = createCols.filter(c => f[c] !== undefined);
    const now  = nowLocal();
    const allCols = [...cols, 'created_at', 'updated_at'];
    const vals    = cols.map(c => f[c]); vals.push(now, now);
    const ph      = allCols.map(() => '?').join(',');
    const info = db.prepare(`INSERT INTO ${table} (${allCols.join(',')}) VALUES (${ph})`).run(...vals);
    const id   = info.lastInsertRowid;
    _clinicalAudit(db, fields.author_id != null ? fields.author_id : fields.facilitator_id, `${table}.create`, table, id);
    save();
    return getById(db, id);
  }
  function update(db = _db, id, fields = {}, userId) {
    if (onWrite) fields = onWrite(fields);
    const f    = _ser(fields);
    const cols = updateCols.filter(c => f[c] !== undefined);
    const sets = cols.map(c => `${c}=?`); sets.push('updated_at=?');
    const vals = cols.map(c => f[c]); vals.push(nowLocal(), id);
    db.prepare(`UPDATE ${table} SET ${sets.join(',')} WHERE id=?`).run(...vals);
    _clinicalAudit(db, userId, `${table}.update`, table, id);
    save();
    return getById(db, id);
  }
  function sign(db = _db, id, userId) {
    const now = nowLocal();
    if (signFinal)
      db.prepare(`UPDATE ${table} SET status='final', signed_at=?, signed_by=?, updated_at=? WHERE id=?`).run(now, userId || null, now, id);
    else
      db.prepare(`UPDATE ${table} SET signed_at=?, signed_by=?, updated_at=? WHERE id=?`).run(now, userId || null, now, id);
    _clinicalAudit(db, userId, `${table}.sign`, table, id);
    save();
    return getById(db, id);
  }
  function del(db = _db, id, userId) {
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    _clinicalAudit(db, userId, `${table}.delete`, table, id);
    save();
    return true;
  }
  return { getAll, getByClient, getById, create, update, sign, delete: del };
}

// ── Group notes — extends the base with attendee handling ──────────────────
const _gnBase = _makeClinical('group_notes', {
  createCols: ['group_name', 'facilitator_id', 'session_date', 'topic', 'content', 'status'],
  updateCols: ['group_name', 'session_date', 'topic', 'content'],
  signFinal:  true,
  dateCol:    'session_date',
});

function _gnGetAttendees(db = _db, groupNoteId) {
  return db.prepare(
    `SELECT a.group_note_id, a.client_id, a.participation, a.individual_note,
            c.name AS client_name, c.room AS room
       FROM group_note_attendees a
       LEFT JOIN clients c ON c.id = a.client_id
      WHERE a.group_note_id = ?
      ORDER BY CAST(c.room AS INTEGER), c.room, c.name`
  ).all(groupNoteId);
}
function _gnInsertAttendees(db, groupNoteId, attendees) {
  const stmt = db.prepare(
    `INSERT INTO group_note_attendees (group_note_id,client_id,participation,individual_note) VALUES (?,?,?,?)`
  );
  (attendees || []).forEach(a => {
    if (!a || a.client_id == null) return;
    const part = ['present', 'absent', 'excused'].includes(a.participation) ? a.participation : 'present';
    try { stmt.run(groupNoteId, a.client_id, part, a.individual_note || ''); } catch (e) { /* skip dup/bad */ }
  });
}
function _gnEmbed(db, row) { if (row) row.attendees = _gnGetAttendees(db, row.id); return row; }

const _groupNotes = {
  getAll(db = _db, clientId) {
    const rows = (clientId != null)
      ? db.prepare(`SELECT gn.* FROM group_notes gn
                    JOIN group_note_attendees a ON a.group_note_id = gn.id
                    WHERE a.client_id = ? ORDER BY gn.session_date DESC, gn.id DESC`).all(clientId)
      : _gnBase.getAll(db);
    return rows.map(r => _gnEmbed(db, r));
  },
  getByClient(db = _db, clientId) { return _groupNotes.getAll(db, clientId); },
  getById(db = _db, id) { return _gnEmbed(db, _gnBase.getById(db, id)); },
  getAttendees: _gnGetAttendees,
  create(db = _db, fields = {}) {
    const row = _gnBase.create(db, fields);
    _gnInsertAttendees(db, row.id, fields.attendees);
    save();
    return _gnEmbed(db, _gnBase.getById(db, row.id));
  },
  update(db = _db, id, fields = {}, userId) {
    _gnBase.update(db, id, fields, userId);
    if (fields.attendees !== undefined) {
      db.prepare(`DELETE FROM group_note_attendees WHERE group_note_id=?`).run(id);
      _gnInsertAttendees(db, id, fields.attendees);
      save();
    }
    return _gnEmbed(db, _gnBase.getById(db, id));
  },
  sign(db = _db, id, userId) { _gnBase.sign(db, id, userId); return _gnEmbed(db, _gnBase.getById(db, id)); },
  delete(db = _db, id, userId) {
    db.prepare(`DELETE FROM group_note_attendees WHERE group_note_id=?`).run(id); // explicit cascade (FK-off test dbs)
    return _gnBase.delete(db, id, userId);
  },
};

const clinicalDb = {
  notes: _makeClinical('clinical_notes', {
    createCols: ['client_id', 'author_id', 'note_type', 'note_date', 'content', 'status'],
    updateCols: ['note_type', 'note_date', 'content'],
    signFinal:  true,
    dateCol:    'note_date',
  }),
  treatmentPlans: _makeClinical('treatment_plans', {
    jsonFields: ['goals'],
    createCols: ['client_id', 'author_id', 'plan_date', 'target_date', 'presenting_problem', 'goals', 'strengths', 'barriers', 'status', 'review_date'],
    updateCols: ['plan_date', 'target_date', 'presenting_problem', 'goals', 'strengths', 'barriers', 'status', 'review_date'],
    signFinal:  false,   // status enum is active|completed|discontinued — sign only stamps signed_at/by
    dateCol:    'plan_date',
    onWrite:    _ensureGoalIds,   // stamp stable ids on goals so milestones can link to them
  }),
  assessments: _makeClinical('assessments', {
    jsonFields: ['content'],
    createCols: ['client_id', 'author_id', 'assessment_type', 'assessment_date', 'content', 'score', 'score_label', 'status'],
    updateCols: ['assessment_type', 'assessment_date', 'content', 'score', 'score_label'],
    signFinal:  true,
    dateCol:    'assessment_date',
  }),
  groupNotes: _groupNotes,
  dischargeSummaries: _makeClinical('discharge_summaries', {
    createCols: ['client_id', 'author_id', 'discharge_date', 'admission_date', 'discharge_type', 'discharge_to', 'presenting_problem', 'treatment_summary', 'progress_toward_goals', 'aftercare_plan', 'follow_up_date', 'status'],
    updateCols: ['discharge_date', 'admission_date', 'discharge_type', 'discharge_to', 'presenting_problem', 'treatment_summary', 'progress_toward_goals', 'aftercare_plan', 'follow_up_date'],
    signFinal:  true,
    dateCol:    'discharge_date',
  }),
  applyMigration: _applyClinicalLiteMigration,
};

// ── Multi-facility sync layer (Phase 1: one-way local → central) ───────
// Operational/clinical tables backed up + reported at HQ. Identity (users,
// groups), config (settings), and the outbox itself are intentionally excluded.
const SYNC_TABLES = [
  'clients','reports','log_entries','staff','passes','chore_log',
  'ua_requests','mail_log','violations',
  'ua_records','med_administration_log','milestones','incidents',
  'discharge_records','consent_records','disclosures',
  'group_sessions','group_attendance','ua_draws','broadcast_messages',
  'audit_log',
];
// Columns holding photos as on-disk paths — inlined to base64 for transport.
const SYNC_PHOTO_COLS = { clients:['photo'], ua_records:['photo'], log_entries:['ua_photo'] };

// Build the outbox + AFTER INSERT/UPDATE/DELETE triggers on every synced table.
// Triggers fire for ALL writes (incl. FK cascade deletes, with recursive_triggers
// ON), so the outbox can never miss a change. Table names come from the hardcoded
// whitelist above — never user input — so the string interpolation is safe.
function _createSyncLayer() {
  _db.pragma('recursive_triggers = ON');  // so ON DELETE CASCADE fires delete triggers
  _db.exec(`CREATE TABLE IF NOT EXISTS sync_outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    row_id     INTEGER NOT NULL,
    op         TEXT NOT NULL,                 -- 'upsert' | 'delete'
    created_at TEXT DEFAULT (datetime('now')),
    synced_at  TEXT DEFAULT NULL
  )`);
  _db.exec('CREATE INDEX IF NOT EXISTS idx_outbox_unsynced ON sync_outbox(synced_at, id)');
  for (const t of SYNC_TABLES) {
    if (!_q1("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])) continue;
    _db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_sync_${t}_ai AFTER INSERT ON ${t}
        BEGIN INSERT INTO sync_outbox(table_name,row_id,op) VALUES('${t}',NEW.id,'upsert'); END;
      CREATE TRIGGER IF NOT EXISTS trg_sync_${t}_au AFTER UPDATE ON ${t}
        BEGIN INSERT INTO sync_outbox(table_name,row_id,op) VALUES('${t}',NEW.id,'upsert'); END;
      CREATE TRIGGER IF NOT EXISTS trg_sync_${t}_ad AFTER DELETE ON ${t}
        BEGIN INSERT INTO sync_outbox(table_name,row_id,op) VALUES('${t}',OLD.id,'delete'); END;
    `);
  }
}

// Enqueue every existing row of every synced table — the new sync baseline.
// Run on enrollment so HQ receives a full snapshot, then live triggers take over.
function enqueueSyncBackfill() {
  _db.transaction(() => {
    _run('DELETE FROM sync_outbox');
    for (const t of SYNC_TABLES) {
      if (!_q1("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])) continue;
      _run(`INSERT INTO sync_outbox(table_name,row_id,op) SELECT '${t}', id, 'upsert' FROM ${t}`);
    }
  })();
  return outboxPending();
}

function outboxPending() {
  const r = _q1('SELECT COUNT(*) AS c FROM sync_outbox WHERE synced_at IS NULL');
  return r ? r.c : 0;
}

// Oldest-first batch of unsynced changes, with row data resolved + photos inlined.
function getSyncBatch(limit = 50) {
  const rows = _q('SELECT id, table_name, row_id, op FROM sync_outbox WHERE synced_at IS NULL ORDER BY id LIMIT ?', [limit]);
  return rows.map(o => {
    if (o.op !== 'upsert') return { id: o.id, table_name: o.table_name, row_id: o.row_id, op: 'delete', data: null };
    const row = _q1(`SELECT * FROM ${o.table_name} WHERE id=?`, [o.row_id]);
    if (!row) return { id: o.id, table_name: o.table_name, row_id: o.row_id, op: 'delete', data: null }; // gone → delete
    const cols = SYNC_PHOTO_COLS[o.table_name];
    if (cols) cols.forEach(c => {
      if (row[c] && typeof row[c] === 'string' && !row[c].startsWith('data:')) { const b = getPhotoB64(row[c]); if (b) row[c] = b; }
    });
    return { id: o.id, table_name: o.table_name, row_id: o.row_id, op: 'upsert', data: row };
  });
}

function markSynced(ids) {
  if (!ids || !ids.length) return;
  const ts = nowLocal();
  _db.transaction(() => {
    const stmt = _db.prepare('UPDATE sync_outbox SET synced_at=? WHERE id=?');
    for (const id of ids) stmt.run(ts, id);
  })();
}

function pruneOutbox() { _run('DELETE FROM sync_outbox WHERE synced_at IS NOT NULL'); }
function clearOutbox() { _run('DELETE FROM sync_outbox'); }  // standalone: keep bounded

// ── Central-managed users (Phase 2b) ───────────────────────────────────
// Apply HQ-mastered users to the local users table. Caller checks the opt-in
// flag first. Safety rails: NEVER modifies/deletes a local (central_managed=0)
// account, and never removes the last admin. HQ is master for identity + role;
// the facility owns the password after the user's first local change.
function applyManagedUsers(list) {
  list = Array.isArray(list) ? list : [];
  let created = 0, updated = 0, removed = 0, skipped = 0;
  const incomingUids = new Set();
  _db.transaction(() => {
    for (const m of list) {
      const uid = String(m.uid || '');
      const uname = String(m.username || '').toLowerCase().trim();
      if (!uid || !uname) { skipped++; continue; }
      incomingUids.add(uid);
      const perms = (Array.isArray(m.permissions) && m.permissions.length)
        ? m.permissions.filter(p => PERMISSIONS.includes(p))
        : (ROLE_PRESETS[m.role] || ROLE_PRESETS.pa).slice();
      const permsJson = JSON.stringify(perms);
      const row = _q1('SELECT * FROM users WHERE central_uid=?', [uid])
               || _q1('SELECT * FROM users WHERE LOWER(username)=?', [uname]);
      if (!row) {
        _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,central_managed,central_uid)
              VALUES (?,?,?,?,?,?,?,1,?)`,
          [uname, String(m.display_name || ''), String(m.role || 'pa'), m.hash || '', m.salt || '', m.must_change_pw ? 1 : 0, permsJson, uid]);
        const newU = _q1('SELECT id FROM users WHERE central_uid=?', [uid]);
        if (newU) {
          const g = _q1('SELECT id FROM groups WHERE key=?', [String(m.role || 'pa')]);
          if (g) _run('INSERT OR IGNORE INTO user_groups (user_id,group_id) VALUES (?,?)', [newU.id, g.id]);
        }
        created++;
      } else if (row.central_managed) {
        const newRole = String(m.role || 'pa');
        // HQ master for identity/permissions; do NOT touch the password.
        _run('UPDATE users SET display_name=?, role=?, permissions=?, central_uid=? WHERE id=?',
          [String(m.display_name || ''), newRole, permsJson, uid, row.id]);
        if (row.role !== newRole) {
          // Role changed — swap group assignment
          const oldG = _q1('SELECT id FROM groups WHERE key=?', [row.role]);
          const newG = _q1('SELECT id FROM groups WHERE key=?', [newRole]);
          if (oldG) _run('DELETE FROM user_groups WHERE user_id=? AND group_id=?', [row.id, oldG.id]);
          if (newG) _run('INSERT OR IGNORE INTO user_groups (user_id,group_id) VALUES (?,?)', [row.id, newG.id]);
        } else {
          // Same role — ensure group is assigned (backfills users created before this fix)
          const noGroup = !_q1('SELECT 1 FROM user_groups WHERE user_id=?', [row.id]);
          if (noGroup) {
            const g = _q1('SELECT id FROM groups WHERE key=?', [newRole]);
            if (g) _run('INSERT OR IGNORE INTO user_groups (user_id,group_id) VALUES (?,?)', [row.id, g.id]);
          }
        }
        updated++;
      } else {
        skipped++; // a LOCAL account owns this username — never hijack it
      }
    }
    // Remove managed users HQ no longer assigns (guard: never drop below 1 admin)
    _q('SELECT id, central_uid FROM users WHERE central_managed=1').forEach(u => {
      if (incomingUids.has(u.central_uid)) return;
      const otherAdmins = _q('SELECT id,permissions FROM users WHERE id<>?', [u.id])
        .filter(x => { try { return JSON.parse(x.permissions || '[]').includes('admin.users'); } catch (e) { return false; } }).length;
      if (otherAdmins < 1) { skipped++; return; }
      _run('DELETE FROM users WHERE id=?', [u.id]);
      removed++;
    });
  })();
  const total = _q1('SELECT COUNT(*) AS c FROM users WHERE central_managed=1');
  setSetting('central_users_count', String(total ? total.c : 0));
  return { created, updated, removed, skipped, total: total ? total.c : 0 };
}

module.exports = {
  init, save, query, query1, run, runAndSave,
  // Multi-facility sync (Phase 1)
  SYNC_TABLES, enqueueSyncBackfill, outboxPending, getSyncBatch, markSynced, pruneOutbox, clearOutbox,
  // Central-managed users (Phase 2b)
  applyManagedUsers,
  clinicalDb,
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
  // ── EHR clinical records ──────────────────────────────────────
  CLINICAL_TABLES,
  isRecordLocked, unlockRecord, runLockSweep,
  // UA Records
  createUARecord, getUARecord, getUARecords, updateUARecord, deleteUARecord,
  // Med Administration Log
  createMedLog, getMedLog, updateMedLog, deleteMedLog,
  // Milestones
  createMilestone, getMilestones, updateMilestone, signoffMilestone, deleteMilestone,
  // Incidents
  createIncident, getIncident, getIncidents, updateIncident, reviewIncident, deleteIncident,
  // Discharge records
  createDischargeRecord, getDischargeRecord, getDischargeRecords,
  // Group sessions + attendance
  getGroupSessions, createGroupSession, deleteGroupSession,
  getGroupAttendance, saveGroupAttendance,
  // Consent + disclosures (42 CFR Part 2)
  createConsentRecord, getConsentRecord, getConsentRecords, revokeConsent, findActiveConsent,
  logDisclosure, getDisclosures,
};
