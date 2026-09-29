-- ============================================================================
-- 011_idempotency_keys.sql — replay-safe writes for the phone's offline queue
--
-- The mobile app keeps round marks, finished rounds, "found" follow-ups and
-- log entries made without signal, and sends them when it reconnects. Each is
-- sent with an Idempotency-Key; the first answer is kept here, so a resend
-- (the phone never heard back) replays it instead of writing twice.
-- server/middleware/idempotency.js. status 0 = still running. Rows are pruned
-- after 48 hours.
--
-- SQLite gets the same table from createSchema() in server/db/migrate.js.
-- Additive and idempotent; apply before restarting onto the code that uses it:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/pg/011_idempotency_keys.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id    integer     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key        text        NOT NULL,
  route      text        NOT NULL DEFAULT '',
  status     integer     NOT NULL DEFAULT 0,
  body       text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys (created_at);

COMMIT;
