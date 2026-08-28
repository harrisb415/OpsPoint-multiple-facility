'use strict';
/**
 * server/db/migrate.js - relational schema (DDL) + additive column migrations.
 *
 * This is the ONLY file that defines OpsPoint's table shapes. A future
 * SQLite -> Postgres port rewrites the DDL here and nothing else. Both
 * functions take the open DB handle so they stay storage-agnostic at the
 * call site. Everything here is idempotent (CREATE TABLE IF NOT EXISTS /
 * ALTER TABLE ADD COLUMN wrapped in try/catch) so it is safe to run on
 * every boot against new and existing databases alike.
 */

// All CREATE TABLE IF NOT EXISTS statements, in dependency order.
function createSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS clients (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    room              TEXT    NOT NULL,
    name              TEXT    NOT NULL DEFAULT 'VACANT',
    case_manager      TEXT    DEFAULT '',
    phone             TEXT    DEFAULT '',
    photo             TEXT    DEFAULT NULL,
    intake_date       TEXT    DEFAULT NULL,
    discharge_date    TEXT    DEFAULT NULL,
    is_special        INTEGER DEFAULT 0,
    is_active         INTEGER DEFAULT 1,
    special_label     TEXT    DEFAULT NULL,
    sort_order        INTEGER DEFAULT 0,
    chore             TEXT    DEFAULT '',
    chore_time        TEXT    DEFAULT '',
    chore_days        TEXT    DEFAULT NULL,
    referral_source   TEXT    DEFAULT '',
    program_track     TEXT    DEFAULT '',
    emergency_contacts TEXT   DEFAULT '[]',
    intake_notes      TEXT    DEFAULT ''
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS reports (
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
  db.exec(`CREATE TABLE IF NOT EXISTS log_entries (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
    time      TEXT,
    text      TEXT,
    ua_photo  TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT UNIQUE NOT NULL,
    display_name TEXT,
    role         TEXT DEFAULT 'pa',
    hash         TEXT,
    salt         TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    must_change_pw INTEGER DEFAULT 0,
    permissions  TEXT DEFAULT NULL,
    is_protected INTEGER DEFAULT 0
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS staff (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    category   TEXT    NOT NULL DEFAULT '',
    name       TEXT    NOT NULL DEFAULT '',
    phone      TEXT    DEFAULT '',
    phone2     TEXT    DEFAULT '',
    notes      TEXT    DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS passes (
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
  db.exec(`CREATE TABLE IF NOT EXISTS chore_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    log_date  TEXT    NOT NULL,
    initials  TEXT    DEFAULT '',
    UNIQUE(client_id, log_date)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS ua_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id       INTEGER NOT NULL,
    client_name     TEXT    DEFAULT '',
    room            TEXT    DEFAULT '',
    requested_by    TEXT    DEFAULT '',
    requested_at    TEXT    DEFAULT (datetime('now')),
    acknowledged    INTEGER DEFAULT 0,
    acknowledged_by TEXT    DEFAULT '',
    acknowledged_at TEXT    DEFAULT '',
    is_interview    INTEGER DEFAULT 0,
    interview_name  TEXT    DEFAULT ''
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS mail_log (
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
    mail_type    TEXT    DEFAULT '',
    created_at   TEXT    DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS violations (
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
  db.exec(`CREATE TABLE IF NOT EXISTS groups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    key          TEXT UNIQUE NOT NULL,
    label        TEXT NOT NULL,
    permissions  TEXT DEFAULT '[]',
    is_protected INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS user_groups (
    user_id  INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, group_id),
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS ua_draws (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    drawn_by       INTEGER NOT NULL,
    drawn_by_name  TEXT    NOT NULL DEFAULT '',
    method         TEXT    NOT NULL DEFAULT 'random',
    residents      TEXT    NOT NULL DEFAULT '[]',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS broadcast_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id    INTEGER NOT NULL,
    sender_name  TEXT    NOT NULL DEFAULT '',
    message      TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
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
  db.exec(`CREATE TABLE IF NOT EXISTS ua_records (
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
    reason             TEXT    DEFAULT '',
    log_entry_id       INTEGER DEFAULT NULL,
    locked_at          TEXT    DEFAULT NULL,
    unlocked_by        TEXT    DEFAULT '',
    unlocked_at        TEXT    DEFAULT NULL,
    unlock_reason      TEXT    DEFAULT '',
    created_by_id      INTEGER NOT NULL,
    created_by_name    TEXT    NOT NULL DEFAULT '',
    created_at         TEXT    DEFAULT (datetime('now'))
  )`);

  // Phase 3 (REMOVED): the witnessed self-administration log was withdrawn.
  // Free-text medication/dose is a transcription-error surface and the feature
  // sat outside this app's "no medications" scope line. The table is NOT dropped:
  // on an existing install it may hold records subject to retention. It is inert.

  // Phase 4: milestone tracker
  db.exec(`CREATE TABLE IF NOT EXISTS milestones (
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
    treatment_plan_id INTEGER DEFAULT NULL,
    goal_id          TEXT    DEFAULT NULL,
    locked_at        TEXT    DEFAULT NULL,
    unlocked_by      TEXT    DEFAULT '',
    unlocked_at      TEXT    DEFAULT NULL,
    unlock_reason    TEXT    DEFAULT '',
    created_by_name  TEXT    DEFAULT '',
    created_at       TEXT    DEFAULT (datetime('now'))
  )`);

  // Phase 5: behavioral incident reports
  db.exec(`CREATE TABLE IF NOT EXISTS incidents (
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
  db.exec(`CREATE TABLE IF NOT EXISTS discharge_records (
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
  db.exec(`CREATE TABLE IF NOT EXISTS consent_records (
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
  db.exec(`CREATE TABLE IF NOT EXISTS disclosures (
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

  // ── Group sessions + attendance (groups.view / groups.log) ────────────
  db.exec(`CREATE TABLE IF NOT EXISTS group_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_date    TEXT    NOT NULL,
    group_name      TEXT    NOT NULL,
    time_of_day     TEXT    DEFAULT '',
    facilitator     TEXT    DEFAULT '',
    notes           TEXT    DEFAULT '',
    created_by_id   INTEGER,
    created_by_name TEXT    DEFAULT '',
    created_at      TEXT    DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS group_attendance (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES group_sessions(id) ON DELETE CASCADE,
    client_id   INTEGER NOT NULL,
    client_name TEXT    NOT NULL DEFAULT '',
    room        TEXT    NOT NULL DEFAULT '',
    present     INTEGER DEFAULT 1,
    notes       TEXT    DEFAULT '',
    UNIQUE(session_id, client_id)
  )`);
}

// Backward-compat column additions for DBs that predate the current schema.
// Each is a no-op once the column exists (try/catch in runColumnMigrations).
const COLUMN_MIGRATIONS = [
    // clients — added post-launch (not in original CREATE TABLE)
    "ALTER TABLE clients ADD COLUMN chore TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN chore_time TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN chore_days TEXT DEFAULT NULL",
    "ALTER TABLE clients ADD COLUMN referral_source TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN program_track TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN emergency_contacts TEXT DEFAULT '[]'",
    "ALTER TABLE clients ADD COLUMN intake_notes TEXT DEFAULT ''",
    // ua_requests — added post-launch
    "ALTER TABLE ua_requests ADD COLUMN is_interview INTEGER DEFAULT 0",
    "ALTER TABLE ua_requests ADD COLUMN interview_name TEXT DEFAULT ''",
    // ua_records — added post-launch
    "ALTER TABLE ua_records ADD COLUMN reason TEXT DEFAULT ''",
    "ALTER TABLE ua_records ADD COLUMN log_entry_id INTEGER DEFAULT NULL",
    "ALTER TABLE ua_records ADD COLUMN is_interview INTEGER DEFAULT 0",
    // mail_log — added post-launch
    "ALTER TABLE mail_log ADD COLUMN mail_type TEXT DEFAULT ''",
    // users — is_protected predates the current CREATE TABLE on some installs
    "ALTER TABLE users ADD COLUMN is_protected INTEGER DEFAULT 0",
    // milestones — optional link to a treatment-plan goal (Structured Clinical Lite)
    "ALTER TABLE milestones ADD COLUMN treatment_plan_id INTEGER DEFAULT NULL",
    "ALTER TABLE milestones ADD COLUMN goal_id TEXT DEFAULT NULL",
    // Central-managed users (multi-facility Phase 2b)
    "ALTER TABLE users ADD COLUMN central_managed INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN central_uid TEXT DEFAULT NULL",
    // chore_log — per-shift initials (columns kept for compat, no longer written)
    "ALTER TABLE chore_log ADD COLUMN am_initials TEXT DEFAULT ''",
    "ALTER TABLE chore_log ADD COLUMN pm_initials TEXT DEFAULT ''",
    // clients — per-day shift assignments (JSON dict: dayIdx → 'AM'|'PM')
    "ALTER TABLE clients ADD COLUMN chore_day_shifts TEXT DEFAULT NULL",
];

function runColumnMigrations(db) {
  COLUMN_MIGRATIONS.forEach(sql => { try { db.exec(sql); } catch (e) {} });
}

module.exports = { createSchema, runColumnMigrations, COLUMN_MIGRATIONS };
