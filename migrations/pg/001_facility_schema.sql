-- ============================================================================
-- 001_facility_schema.sql — OpsPoint facility database, PostgreSQL 18
--
-- Hand-converted from server/db/migrate.js + migrations/001_clinical_lite.sql.
-- Target: database `opspoint`, owned by role `opspoint` (LOGIN only — nothing
-- here needs an extension, an event trigger, or any elevated right).
--
-- Conventions, applied without exception:
--   * every identifier lowercase and unquoted, so folding is a no-op
--   * 0/1 INTEGER flags   -> smallint CHECK (col IN (0,1))   (NOT boolean — see below)
--   * TEXT instants       -> timestamptz   (default now())
--   * TEXT calendar dates -> date
--   * TEXT clock times    -> text          (display strings, not instants)
--   * JSON-in-TEXT stays  -> text          (see NOTE ON JSONB below)
--   * AUTOINCREMENT       -> generated always as identity (see NOTE ON IDENTITY)
--
-- NOTE ON FLAGS —— why smallint and not boolean
-- These 13 columns were boolean in the first draft of this file, which is the
-- idiomatic Postgres choice and the wrong one here. The application stores and
-- returns 0/1 on both drivers: it writes `is_closed ? 1 : 0`, reads back with
-- `!!c.is_active`, and the JSON API hands 0/1 to the React client. Postgres will
-- not implicitly coerce an integer to boolean, so every such INSERT failed with
--   column "must_change_pw" is of type boolean but expression is of type integer
-- and the first Central bring-up could not seed its admin account.
--
-- Converting the app instead would have changed the API's shape AND made the two
-- drivers return different types for the same column — 0/1 on SQLite, true/false
-- on Postgres — which is precisely the divergence the driver seam exists to
-- prevent. SQLite is meant to stay a live rollback, so the storage format has to
-- match. The CHECK constraint keeps the domain honest now that the type is wider
-- than the values it holds.
--
-- NOTE ON IDENTITY —— GENERATED ALWAYS, with two documented exceptions
--   Two code paths insert an explicit id, both restore paths:
--       db.js:975                             INSERT INTO reports (id, ...)
--       server/modules/reports/repository.js  INSERT INTO clients (id, ...)
--   (central/db.js also inserts explicit ids into facilities and managed_users,
--    but those are TEXT UUID primary keys, not identity columns — supplying
--    them is normal and unaffected.)
--
--   ALWAYS is used anyway, because it makes an accidental id insert fail loudly
--   everywhere instead of silently desynchronising the sequence. The two real
--   sites become explicit in Phase 3:
--       INSERT INTO reports (id, ...) OVERRIDING SYSTEM VALUE VALUES (...)
--
--   Either spelling leaves the same trap: an explicit id does NOT advance the
--   sequence, so a later auto-insert collides. Both sites must follow up with
--       SELECT setval(pg_get_serial_sequence('reports','id'),
--                     (SELECT coalesce(max(id), 1) FROM reports));
--
-- NOTE ON JSONB —— deliberately not used yet
--   Columns holding JSON stay text for this migration. Two reasons:
--     1. node-postgres parses jsonb into a JS object automatically, which
--        silently changes every return shape the app already JSON.parse()s.
--        Combining that with the sync->async rewrite means a failure could be
--        either change; keeping them separable is worth more than the elegance.
--     2. settings.value CANNOT be jsonb regardless — setSetting() stores raw
--        strings for string values and JSON for everything else, so the column
--        legitimately holds 'OpsPoint' alongside '{"a":1}'.
--   Converting the genuinely-JSON columns is a clean follow-up change.
--
-- NOTE ON COLLATION
--   The cluster is C locale. The app never used COLLATE NOCASE — SQLite was
--   already sorting BINARY — so byte-order sorting PRESERVES current behaviour
--   rather than changing it. No explicit COLLATE is needed anywhere.
-- ============================================================================

BEGIN;

-- ── settings ────────────────────────────────────────────────────────────────
-- value stays text: it holds raw strings AND serialised JSON. See NOTE ON JSONB.
CREATE TABLE settings (
  key   text PRIMARY KEY,
  value text
);

-- ── clients ─────────────────────────────────────────────────────────────────
-- room_sort exists because ORDER BY CAST(room AS INTEGER) is a live landmine:
-- SQLite silently yields 0 for a non-numeric room, PostgreSQL raises and takes
-- the whole roster query with it. All 151 production rooms are numeric today,
-- so nothing is broken yet — the first 'A1' typed into Admin would break it.
-- The generated column makes the sort total and indexable; queries become
--   ORDER BY room_sort NULLS LAST, room
CREATE TABLE clients (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room               text        NOT NULL,
  name               text        NOT NULL DEFAULT 'VACANT',
  case_manager       text        NOT NULL DEFAULT '',
  phone              text        NOT NULL DEFAULT '',
  photo              text,
  intake_date        date,
  discharge_date     date,
  is_special         smallint    NOT NULL DEFAULT 0 CHECK (is_special IN (0,1)),
  is_active          smallint    NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  special_label      text,
  sort_order         integer     NOT NULL DEFAULT 0,
  chore              text        NOT NULL DEFAULT '',
  chore_time         text        NOT NULL DEFAULT '',
  chore_days         text,
  chore_day_shifts   text,
  referral_source    text        NOT NULL DEFAULT '',
  program_track      text        NOT NULL DEFAULT '',
  emergency_contacts text        NOT NULL DEFAULT '[]',
  intake_notes       text        NOT NULL DEFAULT '',
  room_sort integer GENERATED ALWAYS AS
    (CASE WHEN room ~ '^[0-9]+$' THEN room::integer END) STORED
);
CREATE INDEX idx_clients_active ON clients (is_active);
CREATE INDEX idx_clients_sort   ON clients (room_sort NULLS LAST, room);

-- ── reports ─────────────────────────────────────────────────────────────────
CREATE TABLE reports (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_date      date,
  shift            text,
  mod_name         text        NOT NULL DEFAULT '',
  is_closed        smallint    NOT NULL DEFAULT 0 CHECK (is_closed IN (0,1)),
  statuses         text        NOT NULL DEFAULT '{}',
  comments         text        NOT NULL DEFAULT '{}',
  last_ua          text        NOT NULL DEFAULT '{}',
  last_room_search text        NOT NULL DEFAULT '{}',
  issues           text        NOT NULL DEFAULT '[]',
  med_notes        text        NOT NULL DEFAULT '[]',
  roster_snapshot  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_date ON reports (report_date DESC, id DESC);

-- ── log_entries ─────────────────────────────────────────────────────────────
-- time is a display clock string ('14:30'), not an instant. Stays text.
CREATE TABLE log_entries (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id  integer     REFERENCES reports (id) ON DELETE CASCADE,
  time       text,
  text       text,
  ua_photo   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_log_entries_report ON log_entries (report_id);

-- ── users ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username        text        NOT NULL UNIQUE,
  display_name    text,
  role            text        NOT NULL DEFAULT 'pa',
  hash            text,
  salt            text,
  must_change_pw  smallint    NOT NULL DEFAULT 0 CHECK (must_change_pw IN (0,1)),
  permissions     text,
  is_protected    smallint    NOT NULL DEFAULT 0 CHECK (is_protected IN (0,1)),
  central_managed smallint    NOT NULL DEFAULT 0 CHECK (central_managed IN (0,1)),
  central_uid     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── staff ───────────────────────────────────────────────────────────────────
CREATE TABLE staff (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category   text        NOT NULL DEFAULT '',
  name       text        NOT NULL DEFAULT '',
  phone      text        NOT NULL DEFAULT '',
  phone2     text        NOT NULL DEFAULT '',
  notes      text        NOT NULL DEFAULT '',
  sort_order integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── passes ──────────────────────────────────────────────────────────────────
-- departure / return_date were TEXT holding datetime-local strings.
-- The CHECK encodes the lifecycle the app already enforces in code
-- (server/modules/passes/service.js VALID_STATUS).
CREATE TABLE passes (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id   integer     NOT NULL,
  room        text        NOT NULL DEFAULT '',
  name        text        NOT NULL DEFAULT '',
  departure   timestamptz,
  return_date timestamptz,
  ua_notes    text        NOT NULL DEFAULT '',
  notes       text        NOT NULL DEFAULT '',
  status      text        NOT NULL DEFAULT 'Approved'
              CHECK (status IN ('Approved','Out','Extended','Returned')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_passes_client ON passes (client_id);

-- ── chore_log ───────────────────────────────────────────────────────────────
CREATE TABLE chore_log (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id   integer NOT NULL,
  log_date    date    NOT NULL,
  initials    text    NOT NULL DEFAULT '',
  am_initials text    NOT NULL DEFAULT '',
  pm_initials text    NOT NULL DEFAULT '',
  UNIQUE (client_id, log_date)
);

-- ── ua_requests ─────────────────────────────────────────────────────────────
-- acknowledged_at was TEXT DEFAULT '' — an empty string is not a timestamp.
-- It becomes NULL, and the code that writes '' must write NULL instead.
CREATE TABLE ua_requests (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       integer     NOT NULL,
  client_name     text        NOT NULL DEFAULT '',
  room            text        NOT NULL DEFAULT '',
  requested_by    text        NOT NULL DEFAULT '',
  requested_at    timestamptz NOT NULL DEFAULT now(),
  acknowledged    smallint    NOT NULL DEFAULT 0 CHECK (acknowledged IN (0,1)),
  acknowledged_by text        NOT NULL DEFAULT '',
  acknowledged_at timestamptz,
  is_interview    smallint    NOT NULL DEFAULT 0 CHECK (is_interview IN (0,1)),
  interview_name  text        NOT NULL DEFAULT ''
);
CREATE INDEX idx_ua_requests_open ON ua_requests (acknowledged, requested_at DESC);

-- ── mail_log ────────────────────────────────────────────────────────────────
-- approved_at / delivered_at: same '' -> NULL conversion as above.
CREATE TABLE mail_log (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id    integer     NOT NULL,
  client_name  text        NOT NULL DEFAULT '',
  room         text        NOT NULL DEFAULT '',
  logged_by    text        NOT NULL DEFAULT '',
  logged_at    timestamptz NOT NULL DEFAULT now(),
  report_id    integer     REFERENCES reports (id) ON DELETE SET NULL,
  notes        text        NOT NULL DEFAULT '',
  status       text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','delivered')),
  approved_by  text        NOT NULL DEFAULT '',
  approved_at  timestamptz,
  delivered_at timestamptz,
  mail_type    text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mail_log_client ON mail_log (client_id);

-- ── violations ──────────────────────────────────────────────────────────────
-- consequence_at / completed_at: same '' -> NULL conversion.
CREATE TABLE violations (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id      integer     NOT NULL,
  client_name    text        NOT NULL DEFAULT '',
  room           text        NOT NULL DEFAULT '',
  violation_date date,
  description    text        NOT NULL DEFAULT '',
  logged_by      text        NOT NULL DEFAULT '',
  logged_at      timestamptz NOT NULL DEFAULT now(),
  status         text        NOT NULL DEFAULT 'pending',
  consequence    text        NOT NULL DEFAULT '',
  consequence_by text        NOT NULL DEFAULT '',
  consequence_at timestamptz,
  completed_by   text        NOT NULL DEFAULT '',
  completed_at   timestamptz,
  notes          text        NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_violations_client ON violations (client_id);

-- ── groups / user_groups ────────────────────────────────────────────────────
CREATE TABLE groups (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key          text        NOT NULL UNIQUE,
  label        text        NOT NULL,
  permissions  text        NOT NULL DEFAULT '[]',
  is_protected smallint    NOT NULL DEFAULT 0 CHECK (is_protected IN (0,1)),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_groups (
  user_id  integer NOT NULL REFERENCES users  (id) ON DELETE CASCADE,
  group_id integer NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);

-- ── ua_draws / broadcast_messages ───────────────────────────────────────────
CREATE TABLE ua_draws (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  drawn_by      integer     NOT NULL,
  drawn_by_name text        NOT NULL DEFAULT '',
  method        text        NOT NULL DEFAULT 'random',
  residents     text        NOT NULL DEFAULT '[]',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE broadcast_messages (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id   integer     NOT NULL,
  sender_name text        NOT NULL DEFAULT '',
  message     text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── audit_log ───────────────────────────────────────────────────────────────
-- Six-year retention (45 CFR 164.316(b)(2)(i)); pruneAuditLog floors at 2190
-- days. Index supports the retention sweep and the Admin viewer's date range.
CREATE TABLE audit_log (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts           timestamptz NOT NULL DEFAULT now(),
  actor_id     integer,
  actor_name   text        NOT NULL DEFAULT '',
  ip           text        NOT NULL DEFAULT '',
  action       text        NOT NULL,
  target_type  text        NOT NULL DEFAULT '',
  target_id    text        NOT NULL DEFAULT '',
  target_label text        NOT NULL DEFAULT '',
  detail       text        NOT NULL DEFAULT ''
);
CREATE INDEX idx_audit_log_ts ON audit_log (ts DESC);

-- ── sessions ────────────────────────────────────────────────────────────────
-- expires_at stays an epoch-millisecond integer (bigint, not integer — epoch ms
-- passed 2^31 in 1970+24 days). Keeping the representation avoids rewriting
-- sessionStore's comparison logic during the port; converting it to timestamptz
-- is a reasonable follow-up.
CREATE TABLE sessions (
  sid        text   PRIMARY KEY,
  data       text   NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- ── ua_records ──────────────────────────────────────────────────────────────
CREATE TABLE ua_records (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id         integer     NOT NULL,
  client_name       text        NOT NULL DEFAULT '',
  room              text        NOT NULL DEFAULT '',
  ua_request_id     integer     REFERENCES ua_requests (id) ON DELETE SET NULL,
  report_id         integer     REFERENCES reports     (id) ON DELETE SET NULL,
  tested_at         timestamptz NOT NULL,
  witnessed_by_id   integer     NOT NULL,
  witnessed_by_name text        NOT NULL DEFAULT '',
  collection_method text        NOT NULL DEFAULT 'observed',
  result            text        NOT NULL DEFAULT 'pending',
  panel_results     text        NOT NULL DEFAULT '{}',
  chain_of_custody  text        NOT NULL DEFAULT '',
  photo             text,
  notes             text        NOT NULL DEFAULT '',
  reason            text        NOT NULL DEFAULT '',
  is_interview      smallint    NOT NULL DEFAULT 0 CHECK (is_interview IN (0,1)),
  log_entry_id      integer     REFERENCES log_entries (id) ON DELETE SET NULL,
  locked_at         timestamptz,
  unlocked_by       text        NOT NULL DEFAULT '',
  unlocked_at       timestamptz,
  unlock_reason     text        NOT NULL DEFAULT '',
  created_by_id     integer     NOT NULL,
  created_by_name   text        NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ua_records_client ON ua_records (client_id, tested_at DESC);

-- ── milestones ──────────────────────────────────────────────────────────────
CREATE TABLE milestones (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id         integer     NOT NULL,
  client_name       text        NOT NULL DEFAULT '',
  phase             text        NOT NULL DEFAULT '',
  objective         text        NOT NULL DEFAULT '',
  target_date       date,
  completion_date   date,
  status            text        NOT NULL DEFAULT 'in_progress',
  counselor_id      integer,
  counselor_name    text        NOT NULL DEFAULT '',
  signed_off_at     timestamptz,
  notes             text        NOT NULL DEFAULT '',
  treatment_plan_id integer,
  goal_id           text,
  locked_at         timestamptz,
  unlocked_by       text        NOT NULL DEFAULT '',
  unlocked_at       timestamptz,
  unlock_reason     text        NOT NULL DEFAULT '',
  created_by_name   text        NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_milestones_client ON milestones (client_id, phase, id DESC);

-- ── incidents ───────────────────────────────────────────────────────────────
-- incident_time is a display clock string, not an instant. Stays text.
CREATE TABLE incidents (
  id                     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id              integer     NOT NULL,
  client_name            text        NOT NULL DEFAULT '',
  room                   text        NOT NULL DEFAULT '',
  incident_date          date        NOT NULL,
  incident_time          text        NOT NULL DEFAULT '',
  narrative              text        NOT NULL DEFAULT '',
  severity               text        NOT NULL DEFAULT 'low'
                         CHECK (severity IN ('low','medium','high','critical')),
  corrective_action      text        NOT NULL DEFAULT '',
  notifications_required text        NOT NULL DEFAULT '[]',
  notifications_sent     text        NOT NULL DEFAULT '[]',
  logged_by_id           integer     NOT NULL,
  logged_by_name         text        NOT NULL DEFAULT '',
  supervisor_id          integer,
  supervisor_name        text        NOT NULL DEFAULT '',
  reviewed_at            timestamptz,
  review_notes           text        NOT NULL DEFAULT '',
  status                 text        NOT NULL DEFAULT 'open',
  locked_at              timestamptz,
  unlocked_by            text        NOT NULL DEFAULT '',
  unlocked_at            timestamptz,
  unlock_reason          text        NOT NULL DEFAULT '',
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_incidents_client ON incidents (client_id, incident_date DESC);

-- ── discharge_records ───────────────────────────────────────────────────────
CREATE TABLE discharge_records (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       integer     NOT NULL,
  client_name     text        NOT NULL DEFAULT '',
  room            text        NOT NULL DEFAULT '',
  program_track   text        NOT NULL DEFAULT '',
  intake_date     date,
  discharge_date  date        NOT NULL,
  days_in_program integer     NOT NULL DEFAULT 0,
  reason          text        NOT NULL DEFAULT '',
  narrative       text        NOT NULL DEFAULT '',
  aftercare_plan  text        NOT NULL DEFAULT '',
  referrals_made  text        NOT NULL DEFAULT '[]',
  created_by_id   integer     NOT NULL,
  created_by_name text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_discharge_records_client ON discharge_records (client_id, discharge_date DESC);

-- ── consent_records / disclosures (42 CFR Part 2) ───────────────────────────
CREATE TABLE consent_records (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id         integer     NOT NULL,
  program_name      text        NOT NULL DEFAULT '',
  recipient_name    text        NOT NULL DEFAULT '',
  recipient_org     text        NOT NULL DEFAULT '',
  purpose           text        NOT NULL DEFAULT '',
  information_type  text        NOT NULL DEFAULT '',
  effective_date    date        NOT NULL,
  expiration_date   date,
  revoked           smallint    NOT NULL DEFAULT 0 CHECK (revoked IN (0,1)),
  revoked_at        timestamptz,
  revoked_by        text        NOT NULL DEFAULT '',
  signature_on_file smallint    NOT NULL DEFAULT 0 CHECK (signature_on_file IN (0,1)),
  created_by_id     integer     NOT NULL,
  created_by_name   text        NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_consent_records_client ON consent_records (client_id, effective_date DESC);

CREATE TABLE disclosures (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id         integer     NOT NULL,
  consent_id        integer     REFERENCES consent_records (id) ON DELETE SET NULL,
  recipient         text        NOT NULL DEFAULT '',
  information_type  text        NOT NULL DEFAULT '',
  disclosed_at      timestamptz NOT NULL DEFAULT now(),
  disclosed_by_id   integer     NOT NULL,
  disclosed_by_name text        NOT NULL DEFAULT '',
  method            text        NOT NULL DEFAULT '',
  notes             text        NOT NULL DEFAULT ''
);
CREATE INDEX idx_disclosures_client ON disclosures (client_id, disclosed_at DESC);

-- ── group_sessions / group_attendance ───────────────────────────────────────
CREATE TABLE group_sessions (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_date    date        NOT NULL,
  group_name      text        NOT NULL,
  time_of_day     text        NOT NULL DEFAULT '',
  facilitator     text        NOT NULL DEFAULT '',
  notes           text        NOT NULL DEFAULT '',
  created_by_id   integer,
  created_by_name text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_attendance (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  integer NOT NULL REFERENCES group_sessions (id) ON DELETE CASCADE,
  client_id   integer NOT NULL,
  client_name text    NOT NULL DEFAULT '',
  room        text    NOT NULL DEFAULT '',
  present     smallint NOT NULL DEFAULT 1 CHECK (present IN (0,1)),
  notes       text    NOT NULL DEFAULT '',
  UNIQUE (session_id, client_id)
);

-- ── sync_outbox (multi-facility replication queue) ──────────────────────────
-- Columns must match db.js (getSyncBatch / outboxPending / markSynced): the
-- first draft of this file invented entity/entity_id/payload/sent_at and every
-- read against it failed. The triggers that FILL this table live in
-- 003_fix_sync_outbox.sql — without them the outbox stays permanently empty
-- and nothing ever syncs to HQ, silently.
CREATE TABLE sync_outbox (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text        NOT NULL,
  row_id     integer     NOT NULL,
  op         text        NOT NULL CHECK (op IN ('upsert','delete')),
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at  timestamptz
);
CREATE INDEX idx_outbox_unsynced ON sync_outbox (synced_at NULLS FIRST, id);

-- ============================================================================
-- Structured Clinical Lite — from migrations/001_clinical_lite.sql
--
-- These already declared real foreign keys and CHECK constraints in SQLite and
-- carry over almost unchanged. Note the asymmetry with the operational tables
-- above: everything here references clients(id) and users(id) properly, which
-- is why the FK question below concerns the operational tables, not these.
-- ============================================================================

CREATE TABLE schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinical_notes (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id  integer     NOT NULL REFERENCES clients (id),
  author_id  integer     NOT NULL REFERENCES users   (id),
  note_type  text        NOT NULL DEFAULT 'progress'
             CHECK (note_type IN ('progress','intake','medical','psychosocial','other')),
  note_date  date,
  content    text        NOT NULL DEFAULT '',
  status     text        NOT NULL DEFAULT 'draft'
             CHECK (status IN ('draft','final','amended')),
  signed_at  timestamptz,
  signed_by  integer     REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_clinical_notes_client ON clinical_notes (client_id);
CREATE INDEX idx_clinical_notes_date   ON clinical_notes (note_date);

CREATE TABLE treatment_plans (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id          integer     NOT NULL REFERENCES clients (id),
  author_id          integer     NOT NULL REFERENCES users   (id),
  plan_date          date,
  target_date        date,
  presenting_problem text        NOT NULL DEFAULT '',
  goals              text        NOT NULL DEFAULT '[]',
  strengths          text        NOT NULL DEFAULT '',
  barriers           text        NOT NULL DEFAULT '',
  status             text        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','completed','discontinued')),
  review_date        date,
  signed_at          timestamptz,
  signed_by          integer     REFERENCES users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_treatment_plans_client ON treatment_plans (client_id);
CREATE INDEX idx_treatment_plans_status ON treatment_plans (status);

CREATE TABLE assessments (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id       integer     NOT NULL REFERENCES clients (id),
  author_id       integer     NOT NULL REFERENCES users   (id),
  assessment_type text        NOT NULL DEFAULT 'biopsychosocial'
                  CHECK (assessment_type IN ('biopsychosocial','substance_use','mental_status','trauma','risk','other')),
  assessment_date date,
  content         text        NOT NULL DEFAULT '{}',
  score           double precision,
  score_label     text,
  status          text        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','final')),
  signed_at       timestamptz,
  signed_by       integer     REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_assessments_client ON assessments (client_id);
CREATE INDEX idx_assessments_type   ON assessments (assessment_type);

CREATE TABLE group_notes (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_name     text        NOT NULL DEFAULT '',
  facilitator_id integer     REFERENCES users (id),
  session_date   date,
  topic          text        NOT NULL DEFAULT '',
  content        text        NOT NULL DEFAULT '',
  status         text        NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','final')),
  signed_at      timestamptz,
  signed_by      integer     REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_group_notes_date ON group_notes (session_date);

CREATE TABLE group_note_attendees (
  group_note_id   integer NOT NULL REFERENCES group_notes (id) ON DELETE CASCADE,
  client_id       integer NOT NULL REFERENCES clients     (id) ON DELETE CASCADE,
  participation   text    NOT NULL DEFAULT 'present'
                  CHECK (participation IN ('present','absent','excused')),
  individual_note text    NOT NULL DEFAULT '',
  PRIMARY KEY (group_note_id, client_id)
);
CREATE INDEX idx_group_note_attendees_client ON group_note_attendees (client_id);

CREATE TABLE discharge_summaries (
  id                    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id             integer     NOT NULL REFERENCES clients (id),
  author_id             integer     NOT NULL REFERENCES users   (id),
  discharge_date        date,
  admission_date        date,
  discharge_type        text        NOT NULL DEFAULT 'planned'
                        CHECK (discharge_type IN ('planned','unplanned','ama','transfer','deceased')),
  discharge_to          text        NOT NULL DEFAULT '',
  presenting_problem    text        NOT NULL DEFAULT '',
  treatment_summary     text        NOT NULL DEFAULT '',
  progress_toward_goals text        NOT NULL DEFAULT '',
  aftercare_plan        text        NOT NULL DEFAULT '',
  follow_up_date        date,
  status                text        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','final')),
  signed_at             timestamptz,
  signed_by             integer     REFERENCES users (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_discharge_summaries_client ON discharge_summaries (client_id);

INSERT INTO schema_migrations (version) VALUES ('001_clinical_lite')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- DELIBERATELY NOT INCLUDED — decisions that need your call
--
-- 1. FOREIGN KEYS ON client_id FOR THE OPERATIONAL TABLES
--    passes, chore_log, ua_requests, mail_log, violations, ua_records,
--    milestones, incidents, discharge_records, consent_records, disclosures
--    and group_attendance all carry a client_id with NO foreign key — in
--    SQLite and here. That is not an oversight; it is unresolved.
--
--    DELETE FROM clients runs in four code paths. Adding the constraint forces
--    a choice and neither default is safe:
--      ON DELETE CASCADE  — deleting a resident destroys their consent records,
--                           disclosures log, discharge record and UA history.
--                           Those carry retention requirements. Not acceptable.
--      ON DELETE RESTRICT — clinically correct (you should not be able to erase
--                           a resident who has records) but it BREAKS the four
--                           existing delete paths the moment a client has any.
--
--    Leaving them off preserves today's behaviour exactly, which keeps the port
--    a port. Turning them on is a product decision about whether a resident with
--    clinical records may be deleted at all — worth making, separately.
--
-- 2. med_administration_log
--    Withdrawn in v2.5.0; the SQLite table was kept because it may hold records
--    subject to retention. Production has 1 row. On a wiped database there is
--    nothing to retain, so it is not recreated here. Say if you want the table
--    back as an empty shell.
--
-- 3. TIMESTAMP COLUMNS THAT DEFAULTED TO ''
--    ua_requests.acknowledged_at, mail_log.approved_at, mail_log.delivered_at,
--    violations.consequence_at, violations.completed_at.
--    All are NULL here. Phase 3 must find every site writing '' to these and
--    write NULL — Postgres rejects '' for timestamptz outright, so any missed
--    site fails loudly at runtime rather than silently. That is the good case.
-- ============================================================================
