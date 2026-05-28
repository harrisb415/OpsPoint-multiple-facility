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
];

const ROLE_PRESETS = {
  pa: [
    'reports.create', 'reports.close', 'log.add', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.edit', 'passes.status',
    'reminders.view', 'ua.acknowledge', 'mail.log', 'violations.log',
    'violations.notify_consequence', 'mobile.access',
    'med.witness', 'incidents.log',
  ],
  supervisor: [
    'reports.create', 'reports.close', 'log.add', 'log.delete', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.edit', 'passes.edit', 'passes.status',
    'reminders.view', 'ua.request', 'ua.acknowledge', 'mail.log',
    'violations.log', 'violations.review', 'violations.complete',
    'violations.notify_review', 'violations.notify_consequence',
    'broadcast.send', 'broadcast.receive', 'ua.draw',
    'mobile.access',
    'ua.record', 'med.witness', 'med.delete',
    'milestones.edit', 'incidents.log', 'incidents.review',
  ],
  admin: [
    'reports.create', 'reports.close', 'reports.delete',
    'log.add', 'log.delete', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.edit', 'passes.edit', 'passes.status',
    'ua.request', 'ua.delete', 'mail.log', 'mail.approve', 'mail.delete',
    'violations.log', 'violations.review', 'violations.complete', 'violations.delete',
    'violations.notify_review', 'violations.notify_consequence',
    'broadcast.send', 'broadcast.receive', 'ua.draw',
    'facility.manage', 'admin.users', 'admin.settings', 'admin.audit', 'admin.system',
    'mobile.access',
    'ua.record', 'med.witness', 'med.delete',
    'milestones.edit', 'milestones.signoff',
    'incidents.log', 'incidents.review', 'incidents.delete',
    'consent.manage', 'disclosures.view', 'records.unlock',
  ],
  case_manager: [
    'residents.edit', 'staff.edit', 'passes.edit',
    'ua.request', 'ua.delete', 'mail.approve',
    'violations.notify_review',
    'broadcast.send', 'broadcast.receive',
    'mobile.access',
    'milestones.edit', 'milestones.signoff', 'consent.manage',
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

  // OpsPoint rebrand: rename legacy `infractions` table → `violations` (and column)
  // BEFORE _createSchema() so that the IF NOT EXISTS check finds the renamed table.
  try { _db.exec('ALTER TABLE infractions RENAME TO violations'); } catch(e) {}
  try { _db.exec('ALTER TABLE violations RENAME COLUMN infraction_date TO violation_date'); } catch(e) {}

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
    // ── Phase 1 — Resident profile completion ─────────────────────
    "ALTER TABLE clients ADD COLUMN referral_source TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN program_track TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN emergency_contacts TEXT DEFAULT '[]'",
    "ALTER TABLE clients ADD COLUMN intake_notes TEXT DEFAULT ''",
    // ── Phase 8 — Supervisor unlock columns (idempotent on each clinical table) ──
    "ALTER TABLE ua_records ADD COLUMN unlocked_by TEXT DEFAULT ''",
    "ALTER TABLE ua_records ADD COLUMN unlocked_at TEXT DEFAULT NULL",
    "ALTER TABLE ua_records ADD COLUMN unlock_reason TEXT DEFAULT ''",
    "ALTER TABLE med_administration_log ADD COLUMN unlocked_by TEXT DEFAULT ''",
    "ALTER TABLE med_administration_log ADD COLUMN unlocked_at TEXT DEFAULT NULL",
    "ALTER TABLE med_administration_log ADD COLUMN unlock_reason TEXT DEFAULT ''",
    "ALTER TABLE milestones ADD COLUMN unlocked_by TEXT DEFAULT ''",
    "ALTER TABLE milestones ADD COLUMN unlocked_at TEXT DEFAULT NULL",
    "ALTER TABLE milestones ADD COLUMN unlock_reason TEXT DEFAULT ''",
    "ALTER TABLE incidents ADD COLUMN unlocked_by TEXT DEFAULT ''",
    "ALTER TABLE incidents ADD COLUMN unlocked_at TEXT DEFAULT NULL",
    "ALTER TABLE incidents ADD COLUMN unlock_reason TEXT DEFAULT ''",
    // ── UA reason ────────────────────────────────────────────────────
    "ALTER TABLE ua_records ADD COLUMN reason TEXT DEFAULT ''",
    // ── UA ↔ log entry link (shared chain-of-custody photo) ──────────
    "ALTER TABLE ua_records ADD COLUMN log_entry_id INTEGER DEFAULT NULL",
    // ── Mail type ─────────────────────────────────────────────────────
    "ALTER TABLE mail_log ADD COLUMN mail_type TEXT DEFAULT ''",
  ];
  migrations.forEach(sql => { try { _db.exec(sql); } catch(e) {} });
  _migrateRebrand();
  _seedDefaults();
  _seedExistingUserPermissions();
  _migratePermissions();
  _migrateProfiles();
  _seedGroups();
  _migrateUserGroups();
  _migrateGroups();
  pruneAuditLog(365);
  // Lock any clinical records past their 24h grace window (boot-time sweep)
  try { runLockSweep(); } catch(e) {}
}

// One-time rebrand migration: ShiftPoint → OpsPoint
//  • role `monitor` → `pa` (display "Program Assistant")
//  • permission keys `infractions.*` → `violations.*`
//  • staff category "Monitor" → "Program Assistant"
//  • facility_name 'ShiftPoint' → 'OpsPoint' (only if untouched)
//  • ui_visibility tab `infractions` → `violations`
// All steps are idempotent — safe to run on every boot.
function _migrateRebrand() {
  try { _db.exec("UPDATE users SET role='pa' WHERE role='monitor'"); } catch(e) {}
  try { _db.exec("UPDATE users SET display_name='Program Assistant' WHERE username='monitor' AND (display_name='Monitor' OR display_name IS NULL OR display_name='')"); } catch(e) {}
  try { _db.exec("UPDATE users SET username='pa' WHERE username='monitor'"); } catch(e) {}
  try { _db.exec("UPDATE groups SET key='pa', label='Program Assistant' WHERE key='monitor'"); } catch(e) {}

  // Rewrite permission JSON arrays on users
  try {
    const rows = _q('SELECT id, permissions FROM users WHERE permissions IS NOT NULL');
    rows.forEach(r => {
      const before = r.permissions || '[]';
      const after  = before.replace(/"infractions\./g, '"violations.');
      if (after !== before) _run('UPDATE users SET permissions=? WHERE id=?', [after, r.id]);
    });
  } catch(e) {}

  // Rewrite permission JSON arrays on groups
  try {
    const rows = _q('SELECT id, permissions FROM groups');
    rows.forEach(r => {
      const before = r.permissions || '[]';
      const after  = before.replace(/"infractions\./g, '"violations.');
      if (after !== before) _run('UPDATE groups SET permissions=? WHERE id=?', [after, r.id]);
    });
  } catch(e) {}

  // Rewrite stored permission_profiles setting
  try {
    const row = _q1("SELECT value FROM settings WHERE key='permission_profiles'");
    if (row && row.value) {
      let updated = row.value
        .replace(/"infractions\./g, '"violations.')
        .replace(/"key":"monitor"/g, '"key":"pa"')
        .replace(/"label":"Monitor"/g, '"label":"Program Assistant"');
      if (updated !== row.value) _run("UPDATE settings SET value=? WHERE key='permission_profiles'", [updated]);
    }
  } catch(e) {}

  // staff_categories: Monitor → Program Assistant
  try {
    const row = _q1("SELECT value FROM settings WHERE key='staff_categories'");
    if (row && row.value) {
      const updated = row.value.replace(/"Monitor"/g, '"Program Assistant"');
      if (updated !== row.value) _run("UPDATE settings SET value=? WHERE key='staff_categories'", [updated]);
    }
  } catch(e) {}

  // ui_visibility: tabs.infractions → tabs.violations
  try {
    const row = _q1("SELECT value FROM settings WHERE key='ui_visibility'");
    if (row && row.value) {
      const updated = row.value.replace(/"infractions":/g, '"violations":');
      if (updated !== row.value) _run("UPDATE settings SET value=? WHERE key='ui_visibility'", [updated]);
    }
  } catch(e) {}

  // facility_name: 'ShiftPoint' → 'OpsPoint' (only if user hasn't customized)
  try {
    const row = _q1("SELECT value FROM settings WHERE key='facility_name'");
    if (row && (row.value === 'ShiftPoint' || row.value === '"ShiftPoint"')) {
      _run("UPDATE settings SET value=? WHERE key='facility_name'", ['OpsPoint']);
    }
  } catch(e) {}

  // known_permissions cache: rewrite infractions.* → violations.*
  try {
    const row = _q1("SELECT value FROM settings WHERE key='known_permissions'");
    if (row && row.value) {
      const updated = row.value.replace(/"infractions\./g, '"violations.');
      if (updated !== row.value) _run("UPDATE settings SET value=? WHERE key='known_permissions'", [updated]);
    }
  } catch(e) {}

  // Audit log: rewrite action/target_type strings for historical entries
  try { _db.exec("UPDATE audit_log SET action=replace(action,'infraction','violation') WHERE action LIKE 'infraction%'"); } catch(e) {}
  try { _db.exec("UPDATE audit_log SET target_type='violation' WHERE target_type='infraction'"); } catch(e) {}
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
    role         TEXT DEFAULT 'pa',
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
  _db.exec(`CREATE TABLE IF NOT EXISTS violations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id        INTEGER NOT NULL,
    client_name      TEXT    DEFAULT '',
    room             TEXT    DEFAULT '',
    violation_date  TEXT    DEFAULT '',
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

  // ── EHR expansion tables ────────────────────────────────────────────

  // Phase 2: formal UA records (replaces ad-hoc ua_photo on log entries)
  _db.exec(`CREATE TABLE IF NOT EXISTS ua_records (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id          INTEGER NOT NULL,
    client_name        TEXT    NOT NULL DEFAULT '',
    room               TEXT    NOT NULL DEFAULT '',
    ua_request_id      INTEGER DEFAULT NULL,
    report_id          INTEGER DEFAULT NULL,
    tested_at          TEXT    NOT NULL,
    witnessed_by_id    INTEGER NOT NULL,
    witnessed_by_name  TEXT    NOT NULL DEFAULT '',
    collection_method  TEXT    NOT NULL DEFAULT 'observed',
    result             TEXT    NOT NULL DEFAULT 'pending',
    panel_results      TEXT    NOT NULL DEFAULT '{}',
    chain_of_custody   TEXT    DEFAULT '',
    photo              TEXT    DEFAULT NULL,
    notes              TEXT    DEFAULT '',
    locked_at          TEXT    DEFAULT NULL,
    unlocked_by        TEXT    DEFAULT '',
    unlocked_at        TEXT    DEFAULT NULL,
    unlock_reason      TEXT    DEFAULT '',
    created_by_id      INTEGER NOT NULL,
    created_by_name    TEXT    NOT NULL DEFAULT '',
    created_at         TEXT    DEFAULT (datetime('now'))
  )`);

  // Phase 3: witnessed self-administration log
  _db.exec(`CREATE TABLE IF NOT EXISTS med_administration_log (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id          INTEGER NOT NULL,
    client_name        TEXT    NOT NULL DEFAULT '',
    room               TEXT    NOT NULL DEFAULT '',
    report_id          INTEGER DEFAULT NULL,
    medication         TEXT    NOT NULL DEFAULT '',
    dose               TEXT    DEFAULT '',
    administered_at    TEXT    NOT NULL,
    witnessed_by_id    INTEGER NOT NULL,
    witnessed_by_name  TEXT    NOT NULL DEFAULT '',
    notes              TEXT    DEFAULT '',
    locked_at          TEXT    DEFAULT NULL,
    unlocked_by        TEXT    DEFAULT '',
    unlocked_at        TEXT    DEFAULT NULL,
    unlock_reason      TEXT    DEFAULT '',
    created_by_id      INTEGER NOT NULL,
    created_by_name    TEXT    NOT NULL DEFAULT '',
    created_at         TEXT    DEFAULT (datetime('now'))
  )`);

  // Phase 4: milestone tracker
  _db.exec(`CREATE TABLE IF NOT EXISTS milestones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id        INTEGER NOT NULL,
    client_name      TEXT    NOT NULL DEFAULT '',
    phase            TEXT    NOT NULL DEFAULT '',
    objective        TEXT    NOT NULL DEFAULT '',
    target_date      TEXT    DEFAULT NULL,
    completion_date  TEXT    DEFAULT NULL,
    status           TEXT    NOT NULL DEFAULT 'in_progress',
    counselor_id     INTEGER DEFAULT NULL,
    counselor_name   TEXT    DEFAULT '',
    signed_off_at    TEXT    DEFAULT NULL,
    notes            TEXT    DEFAULT '',
    locked_at        TEXT    DEFAULT NULL,
    unlocked_by      TEXT    DEFAULT '',
    unlocked_at      TEXT    DEFAULT NULL,
    unlock_reason    TEXT    DEFAULT '',
    created_by_name  TEXT    DEFAULT '',
    created_at       TEXT    DEFAULT (datetime('now'))
  )`);

  // Phase 5: behavioral incident reports
  _db.exec(`CREATE TABLE IF NOT EXISTS incidents (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id              INTEGER NOT NULL,
    client_name            TEXT    NOT NULL DEFAULT '',
    room                   TEXT    NOT NULL DEFAULT '',
    incident_date          TEXT    NOT NULL,
    incident_time          TEXT    DEFAULT '',
    narrative              TEXT    NOT NULL DEFAULT '',
    severity               TEXT    NOT NULL DEFAULT 'low',
    corrective_action      TEXT    DEFAULT '',
    notifications_required TEXT    DEFAULT '[]',
    notifications_sent     TEXT    DEFAULT '[]',
    logged_by_id           INTEGER NOT NULL,
    logged_by_name         TEXT    NOT NULL DEFAULT '',
    supervisor_id          INTEGER DEFAULT NULL,
    supervisor_name        TEXT    DEFAULT '',
    reviewed_at            TEXT    DEFAULT NULL,
    review_notes           TEXT    DEFAULT '',
    status                 TEXT    NOT NULL DEFAULT 'open',
    locked_at              TEXT    DEFAULT NULL,
    unlocked_by            TEXT    DEFAULT '',
    unlocked_at            TEXT    DEFAULT NULL,
    unlock_reason          TEXT    DEFAULT '',
    created_at             TEXT    DEFAULT (datetime('now'))
  )`);

  // Phase 6: discharge records (immutable on create — no 24h grace, no unlock)
  _db.exec(`CREATE TABLE IF NOT EXISTS discharge_records (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id        INTEGER NOT NULL,
    client_name      TEXT    NOT NULL DEFAULT '',
    room             TEXT    DEFAULT '',
    program_track    TEXT    DEFAULT '',
    intake_date      TEXT    DEFAULT NULL,
    discharge_date   TEXT    NOT NULL,
    days_in_program  INTEGER DEFAULT 0,
    reason           TEXT    NOT NULL DEFAULT '',
    narrative        TEXT    DEFAULT '',
    aftercare_plan   TEXT    DEFAULT '',
    referrals_made   TEXT    DEFAULT '[]',
    created_by_id    INTEGER NOT NULL,
    created_by_name  TEXT    NOT NULL DEFAULT '',
    created_at       TEXT    DEFAULT (datetime('now'))
  )`);

  // Phase 7: 42 CFR Part 2 consent records
  _db.exec(`CREATE TABLE IF NOT EXISTS consent_records (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id         INTEGER NOT NULL,
    program_name      TEXT    NOT NULL DEFAULT '',
    recipient_name    TEXT    NOT NULL DEFAULT '',
    recipient_org     TEXT    DEFAULT '',
    purpose           TEXT    NOT NULL DEFAULT '',
    information_type  TEXT    NOT NULL DEFAULT '',
    effective_date    TEXT    NOT NULL,
    expiration_date   TEXT    DEFAULT NULL,
    revoked           INTEGER DEFAULT 0,
    revoked_at        TEXT    DEFAULT NULL,
    revoked_by        TEXT    DEFAULT '',
    signature_on_file INTEGER DEFAULT 0,
    created_by_id     INTEGER NOT NULL,
    created_by_name   TEXT    NOT NULL DEFAULT '',
    created_at        TEXT    DEFAULT (datetime('now'))
  )`);

  // Phase 7: disclosures audit (separate from generic audit_log so we can index by client)
  _db.exec(`CREATE TABLE IF NOT EXISTS disclosures (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id         INTEGER NOT NULL,
    consent_id        INTEGER DEFAULT NULL,
    recipient         TEXT    NOT NULL DEFAULT '',
    information_type  TEXT    NOT NULL DEFAULT '',
    disclosed_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    disclosed_by_id   INTEGER NOT NULL,
    disclosed_by_name TEXT    NOT NULL DEFAULT '',
    method            TEXT    DEFAULT '',
    notes             TEXT    DEFAULT ''
  )`);
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

// Migrate permissions for existing users when new permissions are added to presets
function _migratePermissions() {
  const users = _q('SELECT id, role, permissions FROM users WHERE permissions IS NOT NULL');
  users.forEach(u => {
    try {
      let perms = JSON.parse(u.permissions || '[]');
      let changed = false;
      if ((u.role === 'pa' || u.role === 'supervisor') && !perms.includes('ua.acknowledge')) {
        perms.push('ua.acknowledge'); changed = true;
      }
      if ((u.role === 'pa' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('mail.log')) {
        perms.push('mail.log'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('mail.approve')) {
        perms.push('mail.approve'); changed = true;
      }
      if ((u.role === 'pa' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('status.edit')) {
        perms.push('status.edit'); changed = true;
      }
      if ((u.role === 'pa' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('issues.edit')) {
        perms.push('issues.edit'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('ua.delete')) {
        perms.push('ua.delete'); changed = true;
      }
      if ((u.role === 'pa' || u.role === 'supervisor') && !perms.includes('reminders.view')) {
        perms.push('reminders.view'); changed = true;
      }
      if ((u.role === 'pa' || u.role === 'supervisor' || u.role === 'admin' || u.role === 'case_manager') && !perms.includes('mobile.access')) {
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
      if ((u.role === 'pa' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('violations.log')) {
        perms.push('violations.log'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('violations.review')) {
        perms.push('violations.review'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('violations.complete')) {
        perms.push('violations.complete'); changed = true;
      }
      if (u.role === 'admin' && !perms.includes('violations.delete')) {
        perms.push('violations.delete'); changed = true;
      }
      if ((u.role === 'pa' || u.role === 'supervisor' || u.role === 'admin') && !perms.includes('violations.notify_consequence')) {
        perms.push('violations.notify_consequence'); changed = true;
      }
      if ((u.role === 'supervisor' || u.role === 'admin') && !perms.includes('violations.notify_review')) {
        perms.push('violations.notify_review'); changed = true;
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
    pass_notice:            getSetting('pass_notice',            ''),
    staff_categories:       getSetting('staff_categories',       ['Director','Case Manager','Program Assistant','Other']),
    program_tracks:         getSetting('program_tracks',         ['SUD Residential','Re-entry','Transitional','Sober Living']),
    program_phases:         getSetting('program_phases',         []),
    incident_notifications: getSetting('incident_notifications', { low:[], medium:['supervisor'], high:['supervisor','case_manager'], critical:['supervisor','case_manager','licensing','guardian'] }),
    session_idle_mins:      parseInt(getSetting('session_idle_mins', 30)) || 30,
    ui_visibility:          getSetting('ui_visibility',          {}),
  };
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
  _run(`UPDATE ${table} SET locked_at=NULL, unlocked_by=?, unlocked_at=datetime('now'), unlock_reason=? WHERE id=?`,
    [String(by||''), String(reason||''), id]);
}

// Scheduled job — lock any clinical record whose 24h grace period has elapsed.
// Called at boot and every hour.
function runLockSweep() {
  let total = 0;
  CLINICAL_TABLES.forEach(t => {
    try {
      const r = _run(
        `UPDATE ${t} SET locked_at=datetime('now')
         WHERE locked_at IS NULL AND created_at < datetime('now','-24 hours')`
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
      chain_of_custody,photo,notes,created_by_id,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      rec.client_id, rec.client_name||'', rec.room||'',
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
     (client_id,client_name,phase,objective,target_date,status,notes,created_by_name)
     VALUES (?,?,?,?,?,?,?,?)`,
    [rec.client_id, rec.client_name||'', rec.phase||'', rec.objective||'',
     rec.target_date||null, rec.status||'in_progress', rec.notes||'', rec.created_by_name||'']
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
  ['phase','objective','target_date','completion_date','status','notes']
    .forEach(k => { if (patch[k] !== undefined) { fields.push(`${k}=?`); vals.push(patch[k]); } });
  if (!fields.length) return null;
  vals.push(id);
  _run(`UPDATE milestones SET ${fields.join(',')} WHERE id=?`, vals);
  return _q1('SELECT * FROM milestones WHERE id=?', [id]);
}
function signoffMilestone(id, counselorId, counselorName) {
  _run(`UPDATE milestones SET counselor_id=?, counselor_name=?,
        signed_off_at=datetime('now'), status='completed',
        completion_date=COALESCE(completion_date, date('now'))
        WHERE id=?`,
       [counselorId, counselorName||'', id]);
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
        reviewed_at=datetime('now'), review_notes=?, status=? WHERE id=?`,
       [supervisorId, supervisorName||'', reviewNotes||'', newStatus||'reviewed', id]);
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
  _run(`UPDATE consent_records SET revoked=1, revoked_at=datetime('now'), revoked_by=? WHERE id=?`,
       [String(by||''), id]);
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
  // Consent + disclosures (42 CFR Part 2)
  createConsentRecord, getConsentRecord, getConsentRecords, revokeConsent, findActiveConsent,
  logDisclosure, getDisclosures,
};
