-- ============================================================================
-- 007_mobile_rounds_push.sql — the new mobile app's tables
--
-- wellness_rounds / wellness_round_marks: a wellness round kept on the server,
-- so it survives a reload or a dead zone and two staff can split the floors
-- of one round. Finishing it writes the usual shift-log line.
--
-- push_subscriptions: one row per phone that turned alerts on — the browser's
-- push endpoint and keys, the user it belongs to, and its alert toggles.
-- Removed with the user.
--
-- SQLite gets the same tables from createSchema() in server/db/migrate.js.
-- Additive and idempotent; nothing reads these until the matching code is
-- deployed, so apply it before the restart:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/pg/007_mobile_rounds_push.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS wellness_rounds (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id        integer,
  status           text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'finished', 'abandoned')),
  started_by_id    integer,
  started_by_name  text        NOT NULL DEFAULT '',
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_by_id   integer,
  finished_by_name text        NOT NULL DEFAULT '',
  finished_at      timestamptz,
  notes            text        NOT NULL DEFAULT '',
  total            integer     NOT NULL DEFAULT 0,
  missing          integer     NOT NULL DEFAULT 0,
  log_entry_id     integer
);

-- One open round at a time: a second phone pressing Start joins it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wellness_rounds_open ON wellness_rounds (status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS wellness_round_marks (
  round_id       integer     NOT NULL REFERENCES wellness_rounds (id) ON DELETE CASCADE,
  client_id      integer     NOT NULL,
  mark           text        NOT NULL CHECK (mark IN ('ok', 'missing')),
  marked_by_id   integer,
  marked_by_name text        NOT NULL DEFAULT '',
  marked_at      timestamptz NOT NULL DEFAULT now(),
  found_at       timestamptz,
  found_by_name  text        NOT NULL DEFAULT '',
  found_note     text        NOT NULL DEFAULT '',
  PRIMARY KEY (round_id, client_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint    text        NOT NULL UNIQUE,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  user_agent  text        NOT NULL DEFAULT '',
  prefs       text        NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  failures    integer     NOT NULL DEFAULT 0
);

COMMIT;
