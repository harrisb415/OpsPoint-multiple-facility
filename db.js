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
const { localDate } = require('./server/lib/time');   // local calendar day (not the UTC one)

let _db     = null;
let _dbPath = null;

/**
 * "YYYY-MM-DD HH:MM:SS" in local time, shifted by `hours` (negative = past).
 *
 * Two queries used to express their cutoff as datetime('now','-24 hours').
 * That is not portable, and it was also wrong: datetime('now') is UTC, while
 * every created_at in this schema is written by nowLocal(). The comparison was
 * therefore skewed by the machine's UTC offset — seven hours here, enough to
 * lock clinical records early or hide recent broadcasts. Computing the cutoff
 * in the same local format and binding it as a parameter fixes both.
 */
function localShift(hours = 0) {
  const d = new Date(Date.now() + hours * 3600 * 1000), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Returns "YYYY-MM-DD HH:MM:SS" in local time — use instead of datetime('now') (UTC).
function nowLocal() { return localShift(0); }

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
  'passes.notify_extended', // notification (bell + chime) when a pass is extended
  'reminders.view',   // see wellness check and walkthrough reminder banners
  'rounds.notify_missing', // push alert when a resident is not located on a wellness round
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
  // 'med.witness' / 'med.delete' RETIRED — med administration log removed.
  // Absent from PERMISSIONS, so _migratePermissions strips them from users,
  // groups, and profiles on next boot.
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
    'incidents.log',
    'groups.view', 'groups.log',
  ],
  supervisor: [
    'reports.create', 'reports.close', 'log.add', 'log.delete', 'issues.edit', 'status.edit',
    'residents.edit', 'staff.edit', 'chores.assign', 'chores.log', 'passes.edit', 'passes.status',
    'reminders.view', 'ua.request', 'ua.acknowledge', 'mail.log', 'mail.deliver',
    'violations.log', 'violations.review', 'violations.complete',
    'violations.notify_review', 'violations.notify_consequence',
    'broadcast.send', 'broadcast.receive', 'ua.draw',
    'mobile.access', 'rounds.notify_missing',
    'ua.record', 'milestones.edit', 'incidents.log', 'incidents.review',
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
    'mobile.access', 'rounds.notify_missing',
    'ua.record', 'milestones.edit', 'milestones.signoff',
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

// Permissions every role starts with — alerts the whole team needs, like a
// resident not coming back when expected. Appended to each preset here, and
// when one is NEWLY introduced it is granted to every existing group and
// profile, custom ones included, not only the built-in groups whose preset
// lists it (_migrateProfiles / _migrateGroups). An admin can still take it
// away afterwards; it is never re-added once known.
const EVERYONE_PERMS = ['passes.notify_extended'];
for (const preset of Object.values(ROLE_PRESETS)) {
  for (const p of EVERYONE_PERMS) if (!preset.includes(p)) preset.push(p);
}

// ── Driver guard ─────────────────────────────────────────────────────
// The driver defaults to SQLite, and SQLite creates a missing database file
// without complaint. So a Postgres install whose .env lost its
// OPSPOINT_DB_DRIVER line would come up on a brand-new EMPTY database — no
// residents, no reports, no accounts — and look exactly like total data loss.
// Refuse instead, when the evidence says this install is a Postgres one:
// DATABASE_URL still set, the SQLite files the cutover renamed to *.pre-pg,
// or the marker a Postgres boot leaves in the data directory. A deliberate
// rollback (restore the .db files, set the driver to sqlite) still works: the
// guard only fires when there is no SQLite database to open.
function _pgMarker() { return path.join(require('./server/config').DATA_DIR, '.db-driver'); }
function _guardAgainstEmptySqlite(dbPath) {
  if (connection.isPg || fs.existsSync(dbPath)) return;
  let why = null;
  if (process.env.DATABASE_URL) why = 'DATABASE_URL is set';
  else if (fs.existsSync(dbPath + '.pre-pg')) why = `${path.basename(dbPath)}.pre-pg exists (this install was migrated to Postgres)`;
  else { try { if (fs.readFileSync(_pgMarker(), 'utf8').trim() === 'pg') why = `${_pgMarker()} says this install runs on Postgres`; } catch (e) { /* no marker */ } }
  if (!why) return;
  throw new Error(
    `Refusing to start on a new, empty SQLite database: ${why}, but OPSPOINT_DB_DRIVER is not "pg". ` +
    'Set OPSPOINT_DB_DRIVER=pg (and DATABASE_URL) and restart. To deliberately start fresh on SQLite, ' +
    `remove that evidence first.`);
}

// ── Init (synchronous) ───────────────────────────────────────────────
async function init(dbPath) {
  _dbPath = dbPath;
  _guardAgainstEmptySqlite(dbPath);
  const isNew = !connection.isPg && !fs.existsSync(dbPath);
  _db = connection.open(dbPath);   // owns new Database() + WAL/FK pragmas (pg: takes DATABASE_URL)
  if (connection.isPg) {
    // Says where it actually connected — it used to print "Created opspoint.db"
    // under Postgres, naming a SQLite file it never touched.
    let target = 'DATABASE_URL';
    try { const u = new URL(process.env.DATABASE_URL); target = `${u.hostname}/${u.pathname.replace(/^\//, '')}`; } catch (e) { /* keep generic */ }
    console.log('  DB: Postgres', target);
    try { fs.mkdirSync(path.dirname(_pgMarker()), { recursive: true }); fs.writeFileSync(_pgMarker(), 'pg\n'); } catch (e) { /* best effort */ }
  } else {
    console.log('  DB:', isNew ? 'Created' : 'Loaded', path.basename(dbPath));
  }

  // Schema bootstrap is SQLite-only. All three steps emit SQLite-dialect DDL —
  // AUTOINCREMENT, SQLite CREATE TRIGGER, and ALTER TABLE probes that rely on a
  // duplicate-column error — so they would fail on the first statement against
  // Postgres. Under pg the schema is applied out of band from migrations/pg/
  // before the process starts, which also keeps migrate.js as the single SQLite
  // schema definition rather than growing a second dialect inside it.
  if (!connection.isPg) {
    migrate.createSchema(_db);
    _applyClinicalLiteMigration();   // Structured Clinical Lite — idempotent (CREATE IF NOT EXISTS)
    migrate.runColumnMigrations(_db); // additive ALTER-TABLE column migrations (see server/db/migrate.js)
  }
  await _seedDefaults();
  await _seedExistingUserPermissions();
  await _migratePermissions();
  const _bootNewPerms = await _migrateProfiles();
  await _seedGroups();
  await _migrateUserGroups();
  await _migrateGroups(_bootNewPerms);
  // Also SQLite-only: it calls _db.pragma() (a better-sqlite3 method that does
  // not exist on the pg driver) and installs SQLite CREATE TRIGGER statements.
  // Under pg, sync_outbox and its triggers come from migrations/pg/ (the table
  // in 001, the trigger function and per-table triggers in 003).
  if (!connection.isPg) await _createSyncLayer();  // sync_outbox + triggers (multi-facility Phase 1)
  // HIPAA §164.316(b)(2)(i): six-year retention. Setting exists so a facility
  // under a stricter state rule can raise it; pruneAuditLog() floors it so it
  // can never be configured below the statutory minimum.
  await pruneAuditLog(await getSetting('audit_retention_days', AUDIT_RETENTION_MIN_DAYS));
  // Lock any clinical records past their 24h grace window (boot-time sweep)
  try { await runLockSweep(); } catch(e) {}
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

async function getPermissionProfiles() {
  return await getSetting('permission_profiles', _defaultProfiles());
}

async function setPermissionProfiles(profiles) {
  await setSetting('permission_profiles', profiles);
}

async function _seedDefaults() {
  const defs = {
    facility_name:          'OpsPoint',
    // Brand colour theme. Keys are defined in client/src/utils/themes.js and
    // realised as :root[data-theme] blocks in client/src/index.css; the server
    // only stores and allowlists the key.
    facility_theme:         'indigo',
    // Selectable resident statuses, editable in Admin -> Facility -> Statuses.
    // `key` is what gets stored in reports.statuses, so renaming a label is
    // safe but changing a key would orphan historical data — the API blocks
    // removing a key that any report still references. A new facility starts
    // with the built-in set only (SYSTEM_STATUS_KEYS in the facility service),
    // which can be renamed but never removed; anything site-specific is added
    // in Admin. 'vacant' is NOT here: it is derived from name='VACANT', not
    // chosen by staff. Mirrored by DEFAULT_STATUSES in client/src/utils/statuses.js.
    client_statuses:        JSON.stringify([
      { key: 'building', label: 'In Building',  tone: 'green',  system: true },
      { key: 'pass',     label: 'Weekend Pass', tone: 'amber',  system: true },
      { key: 'hospital', label: 'Hospital',     tone: 'red',    system: true },
      { key: 'out',      label: 'Out / Other',  tone: 'orange', system: true },
    ]),
    audit_retention_days:   String(AUDIT_RETENTION_MIN_DAYS),  // 6 years — statutory floor
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
    ui_visibility:          JSON.stringify({"tabs":{"staff":true,"caseloads":true,"chores":true,"groups":true,"passes":true,"mail":true,"ua":true,"ua_draw":true,"violations":true,"consent":true,"clinical":true,"clinical_notes":true,"clinical_treatment":true,"clinical_milestones":true,"clinical_assessments":true,"clinical_groups":true,"clinical_incidents":true,"clinical_discharge":true},"buttons":{"wellness":true,"walkthrough":true}}),
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
    if (!await _q1('SELECT key FROM settings WHERE key=?', [k]))
      await _run('INSERT INTO settings (key,value) VALUES (?,?)', [k, v]);
  }
  // Self-correct an early default that pointed at the PRIVATE source repo — the
  // updater fetches with no token, so the manifest must live on the public
  // releases repo. Safe/idempotent; only rewrites the known-bad value.
  {
    const _mu = await _q1('SELECT value FROM settings WHERE key=?', ['update_manifest_url']);
    if (_mu && /OpsPoint-FULL-HIPAA/.test(_mu.value))
      await _run('UPDATE settings SET value=? WHERE key=?', [defs.update_manifest_url, 'update_manifest_url']);
  }
  // Seed permission profiles if not yet stored
  if (!await _q1('SELECT key FROM settings WHERE key=?', ['permission_profiles']))
    await _run('INSERT INTO settings (key,value) VALUES (?,?)', ['permission_profiles', JSON.stringify(_defaultProfiles())]);
  const cnt = await _q1('SELECT COUNT(*) as c FROM users');
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
    await _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES ('admin','Administrator','admin',?,?,1,?,1)`,[a.hash,a.salt,JSON.stringify(ROLE_PRESETS.admin)]);
    await _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions) VALUES ('supervisor','Supervisor','supervisor',?,?,1,?)`,[s.hash,s.salt,JSON.stringify(ROLE_PRESETS.supervisor)]);
    await _run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions) VALUES ('pa','Program Assistant','pa',?,?,1,?)`,[p.hash,p.salt,JSON.stringify(ROLE_PRESETS.pa)]);
  }
}

// Seed permissions for existing users that predate the permission system
async function _seedExistingUserPermissions() {
  const users = await _q('SELECT id, role FROM users WHERE permissions IS NULL');
  for (const u of users) {
    const perms = ROLE_PRESETS[u.role] || ROLE_PRESETS.pa;
    await _run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(perms), u.id]);
  }
}

// Strip any retired permissions (no longer in PERMISSIONS) from user rows.
// New permissions propagate via _migrateGroups — no need to enumerate them here.
async function _migratePermissions() {
  for (const u of await _q('SELECT id, permissions FROM users WHERE permissions IS NOT NULL')) {
    try {
      const perms   = JSON.parse(u.permissions || '[]');
      const cleaned = perms.filter(p => PERMISSIONS.includes(p));
      if (cleaned.length !== perms.length)
        await _run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(cleaned), u.id]);
    } catch(e) {}
  }
}

// Migrate stored permission profiles when new permissions are added to ROLE_PRESETS.
async function _migrateProfiles() {
  const knownRaw = await _q1('SELECT value FROM settings WHERE key=?', ['known_permissions']);
  const knownPerms = knownRaw ? JSON.parse(knownRaw.value || '[]') : null;
  const newPerms = knownPerms
    ? PERMISSIONS.filter(p => !knownPerms.includes(p))
    : [];
  const knownJson = JSON.stringify(PERMISSIONS);
  if (knownRaw) {
    await _run('UPDATE settings SET value=? WHERE key=?', [knownJson, 'known_permissions']);
  } else {
    await _run('INSERT INTO settings (key,value) VALUES (?,?)', ['known_permissions', knownJson]);
  }
  const profiles = await getPermissionProfiles();
  let changed = false;
  profiles.forEach(p => {
    // Strip retired permissions
    const cleaned = p.permissions.filter(perm => PERMISSIONS.includes(perm));
    if (cleaned.length !== p.permissions.length) { p.permissions = cleaned; changed = true; }
    // Add new perms that belong to this profile's preset (or to everyone)
    const preset = ROLE_PRESETS[p.key];
    newPerms.forEach(perm => {
      const belongs = EVERYONE_PERMS.includes(perm) || (preset && preset.includes(perm));
      if (belongs && !p.permissions.includes(perm)) {
        p.permissions.push(perm);
        changed = true;
      }
    });
  });
  if (changed) await setSetting('permission_profiles', profiles);
  return newPerms; // pass to _migrateGroups so it uses the same delta
}

// ── Groups ────────────────────────────────────────────────────────────
async function _seedGroups() {
  const existing = await _q1('SELECT COUNT(*) as c FROM groups');
  if (existing && existing.c > 0) return;
  const seeds = [
    { key: 'pa',           label: 'Program Assistant', permissions: ROLE_PRESETS.pa,           is_protected: 0 },
    { key: 'supervisor',   label: 'Supervisor',         permissions: ROLE_PRESETS.supervisor,    is_protected: 0 },
    { key: 'admin',        label: 'Administrator',      permissions: ROLE_PRESETS.admin,         is_protected: 1 },
    { key: 'case_manager', label: 'Case Manager',       permissions: ROLE_PRESETS.case_manager,  is_protected: 0 },
  ];
  for (const s of seeds) {
    await _run('INSERT INTO groups (key,label,permissions,is_protected) VALUES (?,?,?,?)',
      [s.key, s.label, JSON.stringify(s.permissions), s.is_protected]);
  }
}

async function _migrateUserGroups() {
  // Assign each user to their matching role group if not already in any group
  const usersNoGroups = await _q(`
    SELECT u.id, u.role FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM user_groups ug WHERE ug.user_id=u.id)
  `);
  for (const u of usersNoGroups) {
    const g = await _q1('SELECT id FROM groups WHERE key=?', [u.role]);
    if (g) await _run('INSERT INTO user_groups (user_id,group_id) VALUES (?,?) ON CONFLICT (user_id,group_id) DO NOTHING', [u.id, g.id]);
  }
}

// Ensure every built-in group contains all permissions its ROLE_PRESET says it should have,
// and strip any retired permissions (no longer in PERMISSIONS) from every group.
// Runs on every boot — idempotent.
async function _migrateGroups(newPerms = []) {
  const groups = await _q('SELECT * FROM groups');
  for (const g of groups) {
    const perms   = _j(g.permissions, []);
    const preset  = ROLE_PRESETS[g.key];
    // Only add permissions that are NEWLY introduced in this boot (not previously known).
    // Never add back permissions that were deliberately removed from a group.
    // EVERYONE_PERMS go to custom groups too; the rest only to their preset's group.
    const toAdd   = newPerms.filter(p =>
      (EVERYONE_PERMS.includes(p) || (preset && preset.includes(p))) && !perms.includes(p));
    const cleaned = perms.filter(p => PERMISSIONS.includes(p)); // drop retired perms
    const stripped = cleaned.length !== perms.length;
    if (!toAdd.length && !stripped) continue;
    const updated = cleaned.concat(toAdd);
    await _run('UPDATE groups SET permissions=? WHERE id=?', [JSON.stringify(updated), g.id]);
    await recomputeGroupMemberPermissions(g.id);
  }
}

async function getGroups() {
  return (await _q('SELECT * FROM groups ORDER BY id')).map(g => ({
    id: g.id, key: g.key, label: g.label,
    permissions: _j(g.permissions, []),
    is_protected: !!g.is_protected,
    created_at: g.created_at,
  }));
}

// `conn` lets these run INSIDE an open transaction. Under Postgres the scoped
// primitives are bound to the transaction's checked-out client; going through
// the module-level _q/_run instead would use a different pooled connection and
// read pre-transaction state — so setUserGroups would recompute permissions
// from the group rows as they were BEFORE its own writes.
async function getUserGroups(userId, conn = connection) {
  return (await conn.query(
    'SELECT g.id,g.key,g.label,g.permissions,g.is_protected FROM groups g JOIN user_groups ug ON ug.group_id=g.id WHERE ug.user_id=? ORDER BY g.id',
    [userId]
  )).map(g => ({ id: g.id, key: g.key, label: g.label, permissions: _j(g.permissions, []), is_protected: !!g.is_protected }));
}

async function computeGroupsPermissions(groupIds) {
  if (!groupIds || !groupIds.length) return [];
  const set = new Set();
  for (const gid of groupIds) {
    const g = await _q1('SELECT permissions FROM groups WHERE id=?', [gid]);
    if (g) _j(g.permissions, []).forEach(p => set.add(p));
  }
  return [...set].filter(p => PERMISSIONS.includes(p));
}

async function getUserEffectivePermissions(userId, conn = connection) {
  const groups = await getUserGroups(userId, conn);
  const set = new Set();
  groups.forEach(g => g.permissions.forEach(p => set.add(p)));
  return [...set].filter(p => PERMISSIONS.includes(p));
}

async function recomputeUserPermissions(userId, conn = connection) {
  const perms = await getUserEffectivePermissions(userId, conn);
  await conn.run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(perms), userId]);
  return perms;
}

async function recomputeGroupMemberPermissions(groupId) {
  for (const m of await _q('SELECT user_id FROM user_groups WHERE group_id=?', [groupId])) { await recomputeUserPermissions(m.user_id); }
}

async function setUserGroups(userId, groupIds) {
  await connection.transaction(async (c) => {
    await c.run('DELETE FROM user_groups WHERE user_id=?', [userId]);
    for (const gid of groupIds) {
      await c.run('INSERT INTO user_groups (user_id,group_id) VALUES (?,?) ON CONFLICT (user_id,group_id) DO NOTHING', [userId, gid]);
    }
    await recomputeUserPermissions(userId, c);
  });
}

async function createGroup(key, label, permissions) {
  permissions = (permissions || []).filter(p => PERMISSIONS.includes(p));
  await _run('INSERT INTO groups (key,label,permissions) VALUES (?,?,?)', [key, label, JSON.stringify(permissions)]);
  return await _q1('SELECT * FROM groups WHERE key=?', [key]);
}

async function updateGroup(id, label, permissions) {
  permissions = (permissions || []).filter(p => PERMISSIONS.includes(p));
  await _run('UPDATE groups SET label=?,permissions=? WHERE id=?', [label, JSON.stringify(permissions), id]);
  await recomputeGroupMemberPermissions(id);
}

async function deleteGroup(id) {
  const members = await _q('SELECT user_id FROM user_groups WHERE group_id=?', [id]);
  await _run('DELETE FROM user_groups WHERE group_id=?', [id]);
  await _run('DELETE FROM groups WHERE id=?', [id]);
  for (const m of members) { await recomputeUserPermissions(m.user_id); }
  return members.map(m => m.user_id);
}

// ── Core helpers ──────────────────────────────────────────────────────
// Primitives delegate to server/db/connection.js (single source of SQL truth).
async function _run(sql, params = []) { return await connection.run(sql, params); }
async function _q(sql, params = [])   { return await connection.query(sql, params); }
async function _q1(sql, params = [])  { return await connection.query1(sql, params); }

/**
 * Does this table exist? There is no portable spelling: sqlite_master does not
 * exist on Postgres, and SQLite has no information_schema. Takes an optional
 * scoped connection so it can be asked inside an open transaction.
 */
async function tableExists(name, conn = connection) {
  const sql = connection.isPg
    ? 'SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename = ?'
    : "SELECT name FROM sqlite_master WHERE type='table' AND name=?";
  return !!(await conn.query1(sql, [name]));
}
// No-op: better-sqlite3 writes directly to disk on every statement
function _save() {}
function _j(str, def) { try { return JSON.parse(str); } catch(e) { return def; } }

// ── Public API ────────────────────────────────────────────────────────
async function query(sql, p=[])  { return await _q(sql, p); }
async function query1(sql, p=[]) { return await _q1(sql, p); }
async function run(sql, p=[])    { return await _run(sql, p); }
function save()             { /* no-op */ }
async function runAndSave(sql, p) { await _run(sql, p); }

async function getSetting(key, def=null) {
  const row = await _q1('SELECT value FROM settings WHERE key=?', [key]);
  if (!row) return def;
  return _j(row.value, row.value);
}
async function setSetting(key, val) {
  const v = typeof val === 'string' ? val : JSON.stringify(val);
  await _run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value', [key, v]);
}
async function setSettingAndSave(key, val) { await setSetting(key, val); }

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
  'ua.record', 'milestones.edit', 'milestones.signoff',
  'incidents.log',   'incidents.review',
  'consent.manage',  'disclosures.view',
];

function _hasClinical(perms) {
  if (!Array.isArray(perms)) return false;
  return CLINICAL_PERMS.some(p => perms.includes(p));
}

async function getAllData(perms) {
  const isClinical = _hasClinical(perms);

  const clients = await _q(`SELECT * FROM clients ORDER BY sort_order, ${connection.roomOrder()}, room`);
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

  const reports = await _q('SELECT * FROM reports ORDER BY created_at');
  for (const r of reports) {
    r.is_closed        = !!r.is_closed;
    r.statuses         = _j(r.statuses, {});
    r.comments         = _j(r.comments, {});
    r.last_ua          = _j(r.last_ua, {});
    r.last_room_search = _j(r.last_room_search, {});
    r.issues           = _j(r.issues, []);
    r.med_notes        = isClinical ? _j(r.med_notes, []) : [];
    r.roster_snapshot  = _j(r.roster_snapshot, null);
    // Was ORDER BY rowid. Every SQLite table has an implicit rowid; Postgres
    // has none, so the query errored outright and took GET /api/data with it.
    // The intent is insertion order, which the identity id gives on both.
    r.log_entries = await _q('SELECT * FROM log_entries WHERE report_id=? ORDER BY id', [r.id]);
    r.log_entries.forEach(function(e) {
      if (e.ua_photo && (typeof e.ua_photo !== 'string' || !e.ua_photo.startsWith('data:'))) {
        e.ua_photo = true;
      }
    });
  }

  const today = localDate();   // local day — the UTC one is tomorrow by evening
  const staffRows = await _q('SELECT * FROM staff ORDER BY sort_order, id');
  const passRows  = await _q("SELECT * FROM passes ORDER BY CASE status WHEN 'Out' THEN 0 WHEN 'Extended' THEN 1 ELSE 2 END, return_date ASC");
  const choreLog  = await _q('SELECT * FROM chore_log WHERE log_date=?', [today]);

  return {
    clients, reports,
    facility_name:          await getSetting('facility_name',          'OpsPoint'),
    wellness_interval_mins: await getSetting('wellness_interval_mins', 120),
    walk_interval_mins:     await getSetting('walk_interval_mins',     240),
    walk_areas:             await getSetting('walk_areas',             DEFAULT_WALK_AREAS),
    ua_panel:               await getSetting('ua_panel',               DEFAULT_UA_PANEL),
    wellness_schedule:      await getSetting('wellness_schedule',      []),
    walk_schedule:          await getSetting('walk_schedule',          []),
    active_report_id:       await getSetting('active_report_id',       null),
    staff:                  staffRows,
    passes:                 passRows,
    chore_log:              choreLog,
    master_chores:          await getSetting('master_chores',          []),
    master_groups:          await getSetting('master_groups',          []),
    pass_notice:            await getSetting('pass_notice',            ''),
    staff_categories:       await getSetting('staff_categories',       ['Director','Case Manager','Program Assistant','Other']),
    program_tracks:         await getSetting('program_tracks',         ['SUD Residential','Re-entry','Transitional','Sober Living']),
    program_phases:         await getSetting('program_phases',         []),
    incident_notifications: await getSetting('incident_notifications', { low:[], medium:['supervisor'], high:['supervisor','case_manager'], critical:['supervisor','case_manager','licensing','guardian'] }),
    session_idle_mins:      parseInt(await getSetting('session_idle_mins', 30)) || 30,
    ui_visibility:          await getSetting('ui_visibility',          {}),
    client_statuses:        await getSetting('client_statuses',      []),
    facility_theme:         await getSetting('facility_theme',       'indigo'),
  };
}

// ── Group sessions + attendance ───────────────────────────────────────
async function getGroupSessions({ date, from, to }) {
  if (from && to) {
    return await _q('SELECT * FROM group_sessions WHERE session_date>=? AND session_date<=? ORDER BY session_date, id', [from, to]);
  }
  const d = date || localDate();
  return await _q('SELECT * FROM group_sessions WHERE session_date=? ORDER BY id', [d]);
}

async function createGroupSession({ session_date, group_name, time_of_day, facilitator, notes, created_by_id, created_by_name }) {
  // Was SELECT last_insert_rowid() — SQLite-only, and racy in principle. The
  // run() result carries the id on both drivers (pg appends RETURNING id).
  const info = await _run(`INSERT INTO group_sessions (session_date,group_name,time_of_day,facilitator,notes,created_by_id,created_by_name,created_at)
        VALUES (?,?,?,?,?,?,?,?)`,
    [session_date, group_name, time_of_day||'', facilitator||'', notes||'', created_by_id||null, created_by_name||'', nowLocal()]);
  const id = info && info.lastInsertRowid;
  return id ? await _q1('SELECT * FROM group_sessions WHERE id=?', [id]) : null;
}

async function deleteGroupSession(id) {
  await _run('DELETE FROM group_sessions WHERE id=?', [id]);
}

async function getGroupAttendance(session_id) {
  return await _q('SELECT * FROM group_attendance WHERE session_id=? ORDER BY room, client_name', [session_id]);
}

async function saveGroupAttendance(session_id, attendees) {
  // attendees: [{client_id, client_name, room, present, notes}]
  for (const a of attendees) {
    await _run(`INSERT INTO group_attendance (session_id,client_id,client_name,room,present,notes)
          VALUES (?,?,?,?,?,?)
          ON CONFLICT(session_id,client_id) DO UPDATE SET
            present=excluded.present, notes=excluded.notes,
            client_name=excluded.client_name, room=excluded.room`,
      [session_id, a.client_id, a.client_name||'', a.room||'', a.present?1:0, a.notes||'']);
  }
}

// ── Clinical record helpers (Phases 2-7) ──────────────────────────────
// All clinical tables share the locked_at immutability pattern and audit-traced reads.
const CLINICAL_TABLES = ['ua_records','milestones','incidents'];

function _parseJsonFields(row, fields) {
  if (!row) return row;
  fields.forEach(f => { if (row[f] != null) row[f] = _j(row[f], f === 'panel_results' ? {} : []); });
  return row;
}

async function isRecordLocked(table, id) {
  if (!CLINICAL_TABLES.includes(table)) return false;
  const row = await _q1(`SELECT locked_at FROM ${table} WHERE id=?`, [id]);
  return !!(row && row.locked_at);
}

async function unlockRecord(table, id, by, reason) {
  if (!CLINICAL_TABLES.includes(table)) throw new Error('Invalid table');
  await _run(`UPDATE ${table} SET locked_at=NULL, unlocked_by=?, unlocked_at=?, unlock_reason=? WHERE id=?`,
    [String(by||''), nowLocal(), String(reason||''), id]);
}

// Scheduled job — lock any clinical record whose 24h grace period has elapsed.
// Called at boot and every hour.
async function runLockSweep() {
  let total = 0;
  for (const t of CLINICAL_TABLES) {
    try {
      const r = await _run(
        `UPDATE ${t} SET locked_at=?
         WHERE locked_at IS NULL AND created_at < ?`,
        [nowLocal(), localShift(-24)]
      );
      total += r.changes || 0;
    } catch(e) {}
  }
  return total;
}

// ── UA Records ────────────────────────────────────────────────────────
async function createUARecord(rec) {
  const r = await _run(
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
  return await getUARecord(r.lastInsertRowid);
}
// Join log_entries so callers can tell whether the linked log entry has a photo
const _UA_SELECT = `
  SELECT ur.*,
    CASE WHEN le.ua_photo IS NOT NULL THEN 1 ELSE 0 END AS has_log_photo
  FROM ua_records ur
  LEFT JOIN log_entries le ON le.id = ur.log_entry_id`;
async function getUARecord(id) {
  return _parseJsonFields(await _q1(_UA_SELECT + ' WHERE ur.id=?', [id]), ['panel_results']);
}
async function getUARecords(filter) {
  filter = filter || {};
  let sql = _UA_SELECT + ' WHERE 1=1';
  const p = [];
  if (filter.client_id) { sql += ' AND ur.client_id=?'; p.push(filter.client_id); }
  if (filter.result)    { sql += ' AND ur.result=?';    p.push(filter.result); }
  if (filter.from)      { sql += ' AND ur.tested_at >= ?'; p.push(filter.from); }
  if (filter.to)        { sql += ' AND ur.tested_at <= ?'; p.push(filter.to); }
  sql += ' ORDER BY ur.tested_at DESC, ur.id DESC LIMIT 500';
  return (await _q(sql, p)).map(r => _parseJsonFields(r, ['panel_results']));
}
async function updateUARecord(id, patch) {
  const fields = [], vals = [];
  ['tested_at','collection_method','result','chain_of_custody','notes','photo']
    .forEach(k => { if (patch[k] !== undefined) { fields.push(`${k}=?`); vals.push(patch[k]); } });
  if (patch.panel_results !== undefined) { fields.push('panel_results=?'); vals.push(JSON.stringify(patch.panel_results||{})); }
  if (!fields.length) return await getUARecord(id);
  vals.push(id);
  await _run(`UPDATE ua_records SET ${fields.join(',')} WHERE id=?`, vals);
  return await getUARecord(id);
}
async function deleteUARecord(id) { await _run('DELETE FROM ua_records WHERE id=?', [id]); }

// ── Milestones ────────────────────────────────────────────────────────
async function createMilestone(rec) {
  const r = await _run(
    `INSERT INTO milestones
     (client_id,client_name,phase,objective,target_date,status,notes,treatment_plan_id,goal_id,created_by_name)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [rec.client_id, rec.client_name||'', rec.phase||'', rec.objective||'',
     rec.target_date||null, rec.status||'in_progress', rec.notes||'',
     rec.treatment_plan_id||null, rec.goal_id||null, rec.created_by_name||'']
  );
  return await _q1('SELECT * FROM milestones WHERE id=?', [r.lastInsertRowid]);
}
async function getMilestones(filter) {
  filter = filter || {};
  let sql = 'SELECT * FROM milestones WHERE 1=1';
  const p = [];
  if (filter.client_id) { sql += ' AND client_id=?'; p.push(filter.client_id); }
  if (filter.status)    { sql += ' AND status=?';    p.push(filter.status); }
  sql += ' ORDER BY client_id, phase, id DESC';
  return await _q(sql, p);
}
// ── Blank form values ─────────────────────────────────────────────────
// A date, timestamp or numeric field left empty arrives as ''. SQLite stored
// the empty string; Postgres refuses it for date, timestamptz and numeric
// columns ("invalid input syntax") and the request 500s. The app's own forms
// send null for a blank, but the API must not depend on every caller doing
// so. Blank means "no value": NULL — or, for a column that cannot be NULL,
// "leave it as it was", so the key is dropped from the write.
const _BLANK_TYPED = /(_date|_at)$|^score$/;
function _blankToNull(fields, keepIfBlank = []) {
  const out = { ...fields };
  for (const [k, v] of Object.entries(out)) {
    if (v !== '' || !_BLANK_TYPED.test(k)) continue;
    if (keepIfBlank.includes(k)) delete out[k]; else out[k] = null;
  }
  return out;
}

async function updateMilestone(id, patch) {
  patch = _blankToNull(patch);
  const fields = [], vals = [];
  ['phase','objective','target_date','completion_date','status','notes','treatment_plan_id','goal_id']
    .forEach(k => { if (patch[k] !== undefined) { fields.push(`${k}=?`); vals.push(patch[k]); } });
  if (!fields.length) return null;
  vals.push(id);
  await _run(`UPDATE milestones SET ${fields.join(',')} WHERE id=?`, vals);
  return await _q1('SELECT * FROM milestones WHERE id=?', [id]);
}
async function signoffMilestone(id, counselorId, counselorName) {
  await _run(`UPDATE milestones SET counselor_id=?, counselor_name=?,
        signed_off_at=?, status='completed',
        completion_date=COALESCE(completion_date, date('now'))
        WHERE id=?`,
       [counselorId, counselorName||'', nowLocal(), id]);
  return await _q1('SELECT * FROM milestones WHERE id=?', [id]);
}
async function deleteMilestone(id) { await _run('DELETE FROM milestones WHERE id=?', [id]); }

// ── Incidents ─────────────────────────────────────────────────────────
async function createIncident(rec) {
  const r = await _run(
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
  return await getIncident(r.lastInsertRowid);
}
async function getIncident(id) {
  return _parseJsonFields(await _q1('SELECT * FROM incidents WHERE id=?', [id]),
    ['notifications_required','notifications_sent']);
}
async function getIncidents(filter) {
  filter = filter || {};
  let sql = 'SELECT * FROM incidents WHERE 1=1';
  const p = [];
  if (filter.client_id) { sql += ' AND client_id=?'; p.push(filter.client_id); }
  if (filter.severity)  { sql += ' AND severity=?';  p.push(filter.severity); }
  if (filter.status)    { sql += ' AND status=?';    p.push(filter.status); }
  sql += ' ORDER BY incident_date DESC, id DESC LIMIT 500';
  return (await _q(sql, p)).map(r => _parseJsonFields(r, ['notifications_required','notifications_sent']));
}
async function updateIncident(id, patch) {
  patch = _blankToNull(patch, ['incident_date']);   // required: a blank keeps the date on file
  const fields = [], vals = [];
  ['incident_date','incident_time','narrative','severity','corrective_action']
    .forEach(k => { if (patch[k] !== undefined) { fields.push(`${k}=?`); vals.push(patch[k]); } });
  if (patch.notifications_required !== undefined) {
    fields.push('notifications_required=?'); vals.push(JSON.stringify(patch.notifications_required||[]));
  }
  if (patch.notifications_sent !== undefined) {
    fields.push('notifications_sent=?'); vals.push(JSON.stringify(patch.notifications_sent||[]));
  }
  if (!fields.length) return await getIncident(id);
  vals.push(id);
  await _run(`UPDATE incidents SET ${fields.join(',')} WHERE id=?`, vals);
  return await getIncident(id);
}
async function reviewIncident(id, supervisorId, supervisorName, reviewNotes, newStatus) {
  await _run(`UPDATE incidents SET supervisor_id=?, supervisor_name=?,
        reviewed_at=?, review_notes=?, status=? WHERE id=?`,
       [supervisorId, supervisorName||'', nowLocal(), reviewNotes||'', newStatus||'reviewed', id]);
  return await getIncident(id);
}
async function deleteIncident(id) { await _run('DELETE FROM incidents WHERE id=?', [id]); }

// ── Discharge Records ─────────────────────────────────────────────────
async function createDischargeRecord(rec) {
  const r = await _run(
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
  return await getDischargeRecord(r.lastInsertRowid);
}
async function getDischargeRecord(id) {
  const row = await _q1('SELECT * FROM discharge_records WHERE id=?', [id]);
  if (row) row.referrals_made = _j(row.referrals_made, []);
  return row;
}
async function getDischargeRecords(filter) {
  filter = filter || {};
  let sql = 'SELECT * FROM discharge_records WHERE 1=1';
  const p = [];
  if (filter.client_id) { sql += ' AND client_id=?'; p.push(filter.client_id); }
  sql += ' ORDER BY discharge_date DESC, id DESC';
  return (await _q(sql, p)).map(r => ({ ...r, referrals_made: _j(r.referrals_made, []) }));
}

// ── 42 CFR Part 2 Consent Records ─────────────────────────────────────
async function createConsentRecord(rec) {
  const r = await _run(
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
  return await _q1('SELECT * FROM consent_records WHERE id=?', [r.lastInsertRowid]);
}
async function getConsentRecord(id) { return await _q1('SELECT * FROM consent_records WHERE id=?', [id]); }
async function getConsentRecords(clientId) {
  return await _q('SELECT * FROM consent_records WHERE client_id=? ORDER BY effective_date DESC, id DESC', [clientId]);
}
async function revokeConsent(id, by) {
  await _run(`UPDATE consent_records SET revoked=1, revoked_at=?, revoked_by=? WHERE id=?`,
       [nowLocal(), String(by||''), id]);
  return await _q1('SELECT * FROM consent_records WHERE id=?', [id]);
}
// Returns the active consent that covers a (client, informationType) pair, or null if blocked.
async function findActiveConsent(clientId, informationType) {
  const now = localDate();   // local day: a consent expiring today is valid all of today
  const rows = await _q(
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
async function logDisclosure(rec) {
  const r = await _run(
    `INSERT INTO disclosures
     (client_id,consent_id,recipient,information_type,disclosed_by_id,disclosed_by_name,method,notes)
     VALUES (?,?,?,?,?,?,?,?)`,
    [rec.client_id, rec.consent_id||null,
     rec.recipient||'', rec.information_type||'',
     rec.disclosed_by_id, rec.disclosed_by_name||'',
     rec.method||'', rec.notes||'']
  );
  return await _q1('SELECT * FROM disclosures WHERE id=?', [r.lastInsertRowid]);
}
async function getDisclosures(clientId) {
  return await _q('SELECT * FROM disclosures WHERE client_id=? ORDER BY disclosed_at DESC, id DESC', [clientId]);
}


// ── Report upsert (wrapped in a transaction) ──────────────────────────
async function upsertReport(r) {
  await connection.transaction(async (c) => {
    const now = new Date().toISOString();
    const exists = await c.query1('SELECT id FROM reports WHERE id=?', [r.id]);
    if (exists) {
      if (r.is_closed && r.roster_snapshot) {
        const existing = await c.query1('SELECT roster_snapshot FROM reports WHERE id=?', [r.id]);
        if (!existing || !existing.roster_snapshot) {
          await c.run('UPDATE reports SET roster_snapshot=? WHERE id=?',
            [JSON.stringify(r.roster_snapshot), r.id]);
        }
      }
      await c.run(`UPDATE reports SET report_date=?,shift=?,mod_name=?,is_closed=?,statuses=?,
        comments=?,last_ua=?,last_room_search=?,issues=?,med_notes=?,updated_at=? WHERE id=?`,
        [r.report_date||null, r.shift||'', r.mod_name||'', r.is_closed?1:0,
         JSON.stringify(r.statuses||{}), JSON.stringify(r.comments||{}),
         JSON.stringify(r.last_ua||{}), JSON.stringify(r.last_room_search||{}),
         JSON.stringify(r.issues||[]), JSON.stringify(r.med_notes||[]), now, r.id]);
      const existingEntries = await c.query('SELECT id,time,text FROM log_entries WHERE report_id=?', [r.id]);
      const existingIds = existingEntries.map(e => e.id);
      const incomingIds = (r.log_entries||[]).filter(e => e.id).map(e => parseInt(e.id));
      const noIdEntries = (r.log_entries||[]).filter(e => !e.id);
      for (const id of existingIds.filter(id => !incomingIds.includes(id))) {
        const dbEntry = existingEntries.find(ex => ex.id === id);
        if (!dbEntry) continue;
        const matchedByText = noIdEntries.some(e =>
          (e.time||'') === (dbEntry.time||'') && (e.text||'') === (dbEntry.text||'')
        );
        if (!matchedByText) await c.run('DELETE FROM log_entries WHERE id=?', [id]);
      }
      for (const e of r.log_entries||[]) {
        if (e.id && existingIds.includes(parseInt(e.id))) {
          const isSentinel = e.ua_photo === true || e.ua_photo === 1;
          if (isSentinel) {
            await c.run('UPDATE log_entries SET time=?,text=? WHERE id=?',
              [e.time||'', e.text||'', e.id]);
          } else {
            await c.run('UPDATE log_entries SET time=?,text=?,ua_photo=? WHERE id=?',
              [e.time||'', e.text||'', e.ua_photo||null, e.id]);
          }
        } else if (!e.id) {
          const dup = existingEntries.find(ex => ex.time===(e.time||'') && ex.text===(e.text||''));
          if (!dup) {
            await c.run('INSERT INTO log_entries (report_id,time,text,ua_photo) VALUES (?,?,?,?)',
              [r.id, e.time||'', e.text||'', e.ua_photo||null]);
          }
        }
      }
    } else {
      let info;
      if (r.id) {
        info = await c.run(`INSERT INTO reports (id,report_date,shift,mod_name,is_closed,statuses,comments,
          last_ua,last_room_search,issues,med_notes,created_at,updated_at)
          ${connection.overriding()}VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.id, r.report_date||null, r.shift||'', r.mod_name||'', r.is_closed?1:0,
           JSON.stringify(r.statuses||{}), JSON.stringify(r.comments||{}),
           JSON.stringify(r.last_ua||{}), JSON.stringify(r.last_room_search||{}),
           JSON.stringify(r.issues||[]), JSON.stringify(r.med_notes||[]), now, now]);
      } else {
        info = await c.run(`INSERT INTO reports (report_date,shift,mod_name,is_closed,statuses,comments,
          last_ua,last_room_search,issues,med_notes,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.report_date||null, r.shift||'', r.mod_name||'', r.is_closed?1:0,
           JSON.stringify(r.statuses||{}), JSON.stringify(r.comments||{}),
           JSON.stringify(r.last_ua||{}), JSON.stringify(r.last_room_search||{}),
           JSON.stringify(r.issues||[]), JSON.stringify(r.med_notes||[]), now, now]);
      }
      // An explicit id does not advance the identity sequence, so the next
      // auto-generated report would collide on the primary key. Re-point it —
      // on THIS transaction's connection, which can see the row just inserted.
      if (r.id) await connection.resyncSequence('reports', 'id', c);
      const useId = r.id || info.lastInsertRowid;
      for (const e of r.log_entries||[]) {
        await c.run('INSERT INTO log_entries (report_id,time,text,ua_photo) VALUES (?,?,?,?)',
          [useId, e.time||'', e.text||'', e.ua_photo||null]);
      }
    }
  });
}

// ── Audit Log ─────────────────────────────────────────────────────────
async function auditLog(actorId, actorName, ip, action, targetType, targetId, targetLabel, detail) {
  try {
    await _run(
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

async function getAuditLog({actionPrefixes, actorId, from, to, search, limit, offset} = {}) {
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
    // ILIKE on pg, LIKE on sqlite — see connection.ilike(). Without this the
    // search silently matches nothing on Postgres for any non-exact casing.
    const L = connection.ilike();
    where.push(`(actor_name ${L} ? OR action ${L} ? OR target_label ${L} ? OR detail ${L} ?)`);
    params.push(s, s, s, s);
  }
  const wc  = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const lim = Math.min(parseInt(limit) || 100, 500);
  const off = parseInt(offset) || 0;
  const countRow = await _q1('SELECT COUNT(*) as c FROM audit_log ' + wc, params);
  const rows = await _q('SELECT * FROM audit_log ' + wc + ' ORDER BY id DESC LIMIT ? OFFSET ?', [...params, lim, off]);
  return { rows, total: countRow ? countRow.c : 0 };
}

// Statutory floor — HIPAA §164.316(b)(2)(i) requires six years retention of
// documentation, which includes the audit trail. 6 x 365 = 2190.
const AUDIT_RETENTION_MIN_DAYS = 2190;

// Status keys referenced by reports. `openOnly` narrows to reports still
// open (is_closed = 0) — a closed report is an immutable record, so a status
// it references can be retired from the picker; one an open shift is actively
// using cannot, or staff would lose the value mid-shift.
async function statusKeysInUse({ openOnly = false } = {}) {
  const keys = new Set();
  try {
    const sql = openOnly
      ? 'SELECT statuses FROM reports WHERE is_closed = 0'
      : 'SELECT statuses FROM reports';
    for (const r of await _q(sql)) {
      let m; try { m = JSON.parse(r.statuses || '{}'); } catch (e) { continue; }
      for (const k of Object.values(m || {})) if (k) keys.add(String(k));
    }
  } catch (e) { /* table may not exist yet */ }
  return [...keys];
}

async function pruneAuditLog(days) {
  // Floor at the statutory minimum. A bad setting, a stale value, or a caller
  // passing 0/null must never shorten retention below what the law requires.
  days = Math.max(parseInt(days, 10) || AUDIT_RETENTION_MIN_DAYS, AUDIT_RETENTION_MIN_DAYS);
  try {
    // Local-time cutoff to match the local-time ts written by auditLog().
    const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000), p = n => String(n).padStart(2, '0');
    const cutoff = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    await _run('DELETE FROM audit_log WHERE ts < ?', [cutoff]);
  } catch(e) {}
}

// ── UA Draws ──────────────────────────────────────────────────────────
async function createUADraw(drawnById, drawnByName, residents) {
  const r = await _run(
    `INSERT INTO ua_draws (drawn_by, drawn_by_name, method, residents) VALUES (?,?,?,?)`,
    [drawnById, drawnByName, 'random', JSON.stringify(residents || [])]
  );
  return await getUADraw(r.lastInsertRowid);
}
async function getUADraw(id) {
  const row = await _q1('SELECT * FROM ua_draws WHERE id=?', [id]);
  if (!row) return null;
  try { row.residents = JSON.parse(row.residents); } catch(e) { row.residents = []; }
  return row;
}
async function getUADraws(sinceDate) {
  const rows = await _q(
    `SELECT * FROM ua_draws WHERE date(created_at) >= date(?) ORDER BY created_at DESC`,
    [sinceDate]
  );
  return rows.map(r => {
    try { r.residents = JSON.parse(r.residents); } catch(e) { r.residents = []; }
    return r;
  });
}
async function getRecentDrawnClientIds(lookbackDays) {
  const since = localDate(-(lookbackDays || 30));
  const rows = await _q(`SELECT residents FROM ua_draws WHERE date(created_at) >= date(?)`, [since]);
  const ids = new Set();
  rows.forEach(r => {
    try { JSON.parse(r.residents).forEach(c => { if (c.id) ids.add(c.id); }); } catch(e) {}
  });
  return ids;
}

// ── Broadcasts ────────────────────────────────────────────────────────
async function createBroadcast(senderId, senderName, message) {
  const r = await _run(
    `INSERT INTO broadcast_messages (sender_id, sender_name, message) VALUES (?,?,?)`,
    [senderId, senderName, message]
  );
  return await getBroadcast(r.lastInsertRowid);
}
async function getBroadcast(id) {
  return await _q1('SELECT * FROM broadcast_messages WHERE id=?', [id]);
}
async function getBroadcasts(limitHours) {
  const hours = limitHours || 24;
  return await _q(
    `SELECT * FROM broadcast_messages WHERE created_at >= ? ORDER BY created_at DESC`,
    [localShift(-hours)]
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

/**
 * Normalise the clinical helpers' `db` argument to the run/query/query1 shape.
 *
 * These helpers all take an explicit connection as their first parameter, and
 * three different things get passed:
 *
 *   • nothing / _db  — the configured driver. Under sqlite _db is a
 *     better-sqlite3 Database; under pg it is a Pool, which has no .prepare().
 *     Either way `connection` is the right object to talk to.
 *   • a raw better-sqlite3 Database — tests/clinical.unit.test.js builds an
 *     in-memory one and passes it in so the unit tests never touch the real
 *     database. That seam is worth keeping, so it is adapted rather than
 *     removed.
 *   • something already driver-shaped — passed through.
 *
 * The sqlite adapter is synchronous, which is fine: awaiting a non-promise is a
 * no-op, so one set of call sites serves both.
 */
function _conn(db) {
  if (!db || db === _db) return connection;
  if (typeof db.prepare === 'function') {
    return {
      run:    (sql, p = []) => db.prepare(sql).run(...p),
      query:  (sql, p = []) => db.prepare(sql).all(...p),
      query1: (sql, p = []) => db.prepare(sql).get(...p) || null,
    };
  }
  return db;
}

// Write an audit row using the EXISTING audit_log schema so clinical activity
// shows up in the same audit viewer as everything else. Never throws.
async function _clinicalAudit(db, userId, action, table, recordId, detail) {
  const c = _conn(db);
  try {
    let name = '';
    try {
      const u = await c.query1('SELECT display_name, username FROM users WHERE id=?', [userId]);
      if (u) name = u.display_name || u.username || '';
    } catch (e) { /* users table may be absent in isolated test dbs */ }
    await c.run(
      `INSERT INTO audit_log (ts,actor_id,actor_name,ip,action,target_type,target_id,target_label,detail)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        nowLocal(), userId || null, String(name).slice(0, 100), '',
        String(action), String(table).slice(0, 50),
        recordId != null ? String(recordId) : '', '',
        (detail && typeof detail === 'object') ? JSON.stringify(detail).slice(0, 2000) : String(detail || '').slice(0, 2000),
      ]
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
  async function getById(db = _db, id) {
    return await _conn(db).query1(`SELECT * FROM ${table} WHERE id=?`, [id]) || null;
  }
  async function getAll(db = _db, clientId) {
    const c = _conn(db);
    if (clientId != null)
      return c.query(`SELECT * FROM ${table} WHERE client_id=? ${order}`, [clientId]);
    return c.query(`SELECT * FROM ${table} ${order}`, []);
  }
  async function getByClient(db = _db, clientId) {
    return _conn(db).query(`SELECT * FROM ${table} WHERE client_id=? ${order}`, [clientId]);
  }
  async function create(db = _db, fields = {}) {
    if (onWrite) fields = onWrite(fields);
    const f    = _ser(_blankToNull(fields));
    const cols = createCols.filter(c => f[c] !== undefined);
    const now  = nowLocal();
    const allCols = [...cols, 'created_at', 'updated_at'];
    const vals    = cols.map(c => f[c]); vals.push(now, now);
    const ph      = allCols.map(() => '?').join(',');
    const info = await _conn(db).run(`INSERT INTO ${table} (${allCols.join(',')}) VALUES (${ph})`, vals);
    const id   = info.lastInsertRowid;
    await _clinicalAudit(db, fields.author_id != null ? fields.author_id : fields.facilitator_id, `${table}.create`, table, id);
    save();
    return await getById(db, id);
  }
  async function update(db = _db, id, fields = {}, userId) {
    if (onWrite) fields = onWrite(fields);
    const f    = _ser(_blankToNull(fields));
    const cols = updateCols.filter(c => f[c] !== undefined);
    const sets = cols.map(c => `${c}=?`); sets.push('updated_at=?');
    const vals = cols.map(c => f[c]); vals.push(nowLocal(), id);
    await _conn(db).run(`UPDATE ${table} SET ${sets.join(',')} WHERE id=?`, vals);
    await _clinicalAudit(db, userId, `${table}.update`, table, id);
    save();
    return await getById(db, id);
  }
  async function sign(db = _db, id, userId) {
    const now = nowLocal();
    if (signFinal)
      await _conn(db).run(`UPDATE ${table} SET status='final', signed_at=?, signed_by=?, updated_at=? WHERE id=?`, [now, userId || null, now, id]);
    else
      await _conn(db).run(`UPDATE ${table} SET signed_at=?, signed_by=?, updated_at=? WHERE id=?`, [now, userId || null, now, id]);
    await _clinicalAudit(db, userId, `${table}.sign`, table, id);
    save();
    return await getById(db, id);
  }
  async function del(db = _db, id, userId) {
    await _conn(db).run(`DELETE FROM ${table} WHERE id=?`, [id]);
    await _clinicalAudit(db, userId, `${table}.delete`, table, id);
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

async function _gnGetAttendees(db = _db, groupNoteId) {
  return _conn(db).query(
    `SELECT a.group_note_id, a.client_id, a.participation, a.individual_note,
            c.name AS client_name, c.room AS room
       FROM group_note_attendees a
       LEFT JOIN clients c ON c.id = a.client_id
      WHERE a.group_note_id = ?
      ORDER BY ${connection.roomOrder('c.room')}, c.room, c.name`,
    [groupNoteId]
  );
}
async function _gnInsertAttendees(db, groupNoteId, attendees) {
  // Was a single prepared statement reused across the loop — a better-sqlite3
  // optimisation with no portable equivalent. The driver re-parses per call;
  // attendee lists are one group session, so the cost is not material.
  const c = _conn(db);
  for (const a of (attendees || [])) {
    if (!a || a.client_id == null) continue;
    const part = ['present', 'absent', 'excused'].includes(a.participation) ? a.participation : 'present';
    try {
      await c.run(
        `INSERT INTO group_note_attendees (group_note_id,client_id,participation,individual_note) VALUES (?,?,?,?)`,
        [groupNoteId, a.client_id, part, a.individual_note || '']
      );
    } catch (e) { /* skip dup/bad */ }
  }
}
async function _gnEmbed(db, row) { if (row) row.attendees = await _gnGetAttendees(db, row.id); return row; }

const _groupNotes = {
  async getAll(db = _db, clientId) {
    const rows = (clientId != null)
      ? await _conn(db).query(`SELECT gn.* FROM group_notes gn
                    JOIN group_note_attendees a ON a.group_note_id = gn.id
                    WHERE a.client_id = ? ORDER BY gn.session_date DESC, gn.id DESC`, [clientId])
      : await _gnBase.getAll(db);
    // _gnEmbed queries the attendee list per row, so a bare .map() here would
    // hand back an array of Promises.
    return Promise.all(rows.map(async r => await _gnEmbed(db, r)));
  },
  async getByClient(db = _db, clientId) { return _groupNotes.getAll(db, clientId); },
  async getById(db = _db, id) { return await _gnEmbed(db, await _gnBase.getById(db, id)); },
  getAttendees: _gnGetAttendees,
  async create(db = _db, fields = {}) {
    const row = await _gnBase.create(db, fields);
    await _gnInsertAttendees(db, row.id, fields.attendees);
    save();
    return await _gnEmbed(db, await _gnBase.getById(db, row.id));
  },
  async update(db = _db, id, fields = {}, userId) {
    await _gnBase.update(db, id, fields, userId);
    if (fields.attendees !== undefined) {
      await _conn(db).run(`DELETE FROM group_note_attendees WHERE group_note_id=?`, [id]);
      await _gnInsertAttendees(db, id, fields.attendees);
      save();
    }
    return await _gnEmbed(db, await _gnBase.getById(db, id));
  },
  async sign(db = _db, id, userId) { await _gnBase.sign(db, id, userId); return await _gnEmbed(db, await _gnBase.getById(db, id)); },
  async delete(db = _db, id, userId) {
    await _conn(db).run(`DELETE FROM group_note_attendees WHERE group_note_id=?`, [id]); // explicit cascade (FK-off test dbs)
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
  'ua_records','milestones','incidents',
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
async function _createSyncLayer() {
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
    if (!await _q1("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])) continue;
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
async function enqueueSyncBackfill() {
  await connection.transaction(async (c) => {
    await c.run('DELETE FROM sync_outbox');
    for (const t of SYNC_TABLES) {
      if (!await tableExists(t, c)) continue;
      await c.run(`INSERT INTO sync_outbox(table_name,row_id,op) SELECT '${t}', id, 'upsert' FROM ${t}`);
    }
  });
  return await outboxPending();
}

async function outboxPending() {
  const r = await _q1('SELECT COUNT(*) AS c FROM sync_outbox WHERE synced_at IS NULL');
  return r ? r.c : 0;
}

// Oldest-first batch of unsynced changes, with row data resolved + photos inlined.
async function getSyncBatch(limit = 50) {
  const rows = await _q('SELECT id, table_name, row_id, op FROM sync_outbox WHERE synced_at IS NULL ORDER BY id LIMIT ?', [limit]);
  return Promise.all(rows.map(async o => {
    if (o.op !== 'upsert') return { id: o.id, table_name: o.table_name, row_id: o.row_id, op: 'delete', data: null };
    const row = await _q1(`SELECT * FROM ${o.table_name} WHERE id=?`, [o.row_id]);
    if (!row) return { id: o.id, table_name: o.table_name, row_id: o.row_id, op: 'delete', data: null }; // gone → delete
    const cols = SYNC_PHOTO_COLS[o.table_name];
    if (cols) cols.forEach(c => {
      if (row[c] && typeof row[c] === 'string' && !row[c].startsWith('data:')) { const b = getPhotoB64(row[c]); if (b) row[c] = b; }
    });
    return { id: o.id, table_name: o.table_name, row_id: o.row_id, op: 'upsert', data: row };
  }));
}

async function markSynced(ids) {
  if (!ids || !ids.length) return;
  const ts = nowLocal();
  await connection.transaction(async (c) => {
    for (const id of ids) await c.run('UPDATE sync_outbox SET synced_at=? WHERE id=?', [ts, id]);
  });
}

async function pruneOutbox() { await _run('DELETE FROM sync_outbox WHERE synced_at IS NOT NULL'); }
async function clearOutbox() { await _run('DELETE FROM sync_outbox'); }  // standalone: keep bounded

// ── Central-managed users (Phase 2b) ───────────────────────────────────
// Apply HQ-mastered users to the local users table. Caller checks the opt-in
// flag first. Safety rails: NEVER modifies/deletes a local (central_managed=0)
// account, and never removes the last admin. HQ is master for identity + role;
// the facility owns the password after the user's first local change.
async function applyManagedUsers(list) {
  list = Array.isArray(list) ? list : [];
  let created = 0, updated = 0, removed = 0, skipped = 0;
  const incomingUids = new Set();
  await connection.transaction(async (c) => {
    for (const m of list) {
      const uid = String(m.uid || '');
      const uname = String(m.username || '').toLowerCase().trim();
      if (!uid || !uname) { skipped++; continue; }
      incomingUids.add(uid);
      const perms = (Array.isArray(m.permissions) && m.permissions.length)
        ? m.permissions.filter(p => PERMISSIONS.includes(p))
        : (ROLE_PRESETS[m.role] || ROLE_PRESETS.pa).slice();
      const permsJson = JSON.stringify(perms);
      const row = await c.query1('SELECT * FROM users WHERE central_uid=?', [uid])
               || await c.query1('SELECT * FROM users WHERE LOWER(username)=?', [uname]);
      if (!row) {
        await c.run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,central_managed,central_uid)
              VALUES (?,?,?,?,?,?,?,1,?)`,
          [uname, String(m.display_name || ''), String(m.role || 'pa'), m.hash || '', m.salt || '', m.must_change_pw ? 1 : 0, permsJson, uid]);
        const newU = await c.query1('SELECT id FROM users WHERE central_uid=?', [uid]);
        if (newU) {
          const g = await c.query1('SELECT id FROM groups WHERE key=?', [String(m.role || 'pa')]);
          if (g) await c.run('INSERT INTO user_groups (user_id,group_id) VALUES (?,?) ON CONFLICT (user_id,group_id) DO NOTHING', [newU.id, g.id]);
        }
        created++;
      } else if (row.central_managed) {
        const newRole = String(m.role || 'pa');
        // HQ master for identity/permissions; do NOT touch the password.
        await c.run('UPDATE users SET display_name=?, role=?, permissions=?, central_uid=? WHERE id=?',
          [String(m.display_name || ''), newRole, permsJson, uid, row.id]);
        if (row.role !== newRole) {
          // Role changed — swap group assignment
          const oldG = await c.query1('SELECT id FROM groups WHERE key=?', [row.role]);
          const newG = await c.query1('SELECT id FROM groups WHERE key=?', [newRole]);
          if (oldG) await c.run('DELETE FROM user_groups WHERE user_id=? AND group_id=?', [row.id, oldG.id]);
          if (newG) await c.run('INSERT INTO user_groups (user_id,group_id) VALUES (?,?) ON CONFLICT (user_id,group_id) DO NOTHING', [row.id, newG.id]);
        } else {
          // Same role — ensure group is assigned (backfills users created before this fix)
          const noGroup = !await c.query1('SELECT 1 FROM user_groups WHERE user_id=?', [row.id]);
          if (noGroup) {
            const g = await c.query1('SELECT id FROM groups WHERE key=?', [newRole]);
            if (g) await c.run('INSERT INTO user_groups (user_id,group_id) VALUES (?,?) ON CONFLICT (user_id,group_id) DO NOTHING', [row.id, g.id]);
          }
        }
        updated++;
      } else {
        skipped++; // a LOCAL account owns this username — never hijack it
      }
    }
    // Remove managed users HQ no longer assigns (guard: never drop below 1 admin)
    for (const u of await c.query('SELECT id, central_uid FROM users WHERE central_managed=1')) {
      if (incomingUids.has(u.central_uid)) continue;
      const otherAdmins = (await c.query('SELECT id,permissions FROM users WHERE id<>?', [u.id]))
        .filter(x => { try { return JSON.parse(x.permissions || '[]').includes('admin.users'); } catch (e) { return false; } }).length;
      if (otherAdmins < 1) { skipped++; continue; }
      await c.run('DELETE FROM users WHERE id=?', [u.id]);
      removed++;
    }
  });
  const total = await _q1('SELECT COUNT(*) AS c FROM users WHERE central_managed=1');
  await setSetting('central_users_count', String(total ? total.c : 0));
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
  statusKeysInUse,
  // Scheduled backup (backup.js) — VACUUM INTO snapshot + the live DB path.
  backupTo: (dest) => connection.backupTo(dest),
  getDbPath: () => connection.getPath(),
  // ── EHR clinical records ──────────────────────────────────────
  CLINICAL_TABLES,
  isRecordLocked, unlockRecord, runLockSweep,
  // UA Records
  createUARecord, getUARecord, getUARecords, updateUARecord, deleteUARecord,
  // Med Administration Log
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
