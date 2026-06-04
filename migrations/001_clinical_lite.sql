-- ============================================================================
-- 001_clinical_lite.sql — Structured Clinical Lite
-- Idempotent: every statement is CREATE TABLE/INDEX IF NOT EXISTS or OR IGNORE.
-- Safe to re-run against an existing database. Applied at boot by db.js and
-- runnable standalone for tests / manual migration.
--
-- Scope (per product constraint): clinical documentation only.
--   NO medications, e-prescribe, claims, or labs anywhere in this schema.
-- ============================================================================

-- ── Migration guard ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('001_clinical_lite');

-- ── 1. Clinical Notes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinical_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id),
  author_id  INTEGER NOT NULL REFERENCES users(id),
  note_type  TEXT NOT NULL DEFAULT 'progress'
             CHECK (note_type IN ('progress','intake','medical','psychosocial','other')),
  note_date  TEXT,
  content    TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'draft'
             CHECK (status IN ('draft','final','amended')),
  signed_at  TEXT DEFAULT NULL,
  signed_by  INTEGER DEFAULT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── 2. Treatment Plans ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_plans (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id          INTEGER NOT NULL REFERENCES clients(id),
  author_id          INTEGER NOT NULL REFERENCES users(id),
  plan_date          TEXT,
  target_date        TEXT DEFAULT NULL,
  presenting_problem TEXT DEFAULT '',
  goals              TEXT DEFAULT '[]',          -- JSON array of {goal,objectives[],interventions[]}
  strengths          TEXT DEFAULT '',
  barriers           TEXT DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','completed','discontinued')),
  review_date        TEXT DEFAULT NULL,
  signed_at          TEXT DEFAULT NULL,
  signed_by          INTEGER DEFAULT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── 3. Assessments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL REFERENCES clients(id),
  author_id       INTEGER NOT NULL REFERENCES users(id),
  assessment_type TEXT NOT NULL DEFAULT 'biopsychosocial'
                  CHECK (assessment_type IN ('biopsychosocial','substance_use','mental_status','trauma','risk','other')),
  assessment_date TEXT,
  content         TEXT DEFAULT '{}',             -- JSON object (type-specific structured fields)
  score           REAL DEFAULT NULL,
  score_label     TEXT DEFAULT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','final')),
  signed_at       TEXT DEFAULT NULL,
  signed_by       INTEGER DEFAULT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── 4. Group Notes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_notes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name     TEXT DEFAULT '',
  facilitator_id INTEGER REFERENCES users(id),
  session_date   TEXT,
  topic          TEXT DEFAULT '',
  content        TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','final')),
  signed_at      TEXT DEFAULT NULL,
  signed_by      INTEGER DEFAULT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── 5. Group Note Attendees ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_note_attendees (
  group_note_id   INTEGER NOT NULL REFERENCES group_notes(id) ON DELETE CASCADE,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  participation   TEXT NOT NULL DEFAULT 'present'
                  CHECK (participation IN ('present','absent','excused')),
  individual_note TEXT DEFAULT '',
  PRIMARY KEY (group_note_id, client_id)
);

-- ── 6. Discharge Summaries ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discharge_summaries (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id            INTEGER NOT NULL REFERENCES clients(id),
  author_id            INTEGER NOT NULL REFERENCES users(id),
  discharge_date       TEXT,
  admission_date       TEXT DEFAULT NULL,
  discharge_type       TEXT NOT NULL DEFAULT 'planned'
                       CHECK (discharge_type IN ('planned','unplanned','ama','transfer','deceased')),
  discharge_to         TEXT DEFAULT '',
  presenting_problem   TEXT DEFAULT '',
  treatment_summary    TEXT DEFAULT '',
  progress_toward_goals TEXT DEFAULT '',
  aftercare_plan       TEXT DEFAULT '',
  follow_up_date       TEXT DEFAULT NULL,
  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','final')),
  signed_at            TEXT DEFAULT NULL,
  signed_by            INTEGER DEFAULT NULL REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clinical_notes_client    ON clinical_notes(client_id);
CREATE INDEX IF NOT EXISTS idx_clinical_notes_date       ON clinical_notes(note_date);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_client    ON treatment_plans(client_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_status    ON treatment_plans(status);
CREATE INDEX IF NOT EXISTS idx_assessments_client        ON assessments(client_id);
CREATE INDEX IF NOT EXISTS idx_assessments_type          ON assessments(assessment_type);
CREATE INDEX IF NOT EXISTS idx_group_notes_date          ON group_notes(session_date);
CREATE INDEX IF NOT EXISTS idx_group_note_attendees_client ON group_note_attendees(client_id);
CREATE INDEX IF NOT EXISTS idx_discharge_summaries_client  ON discharge_summaries(client_id);
