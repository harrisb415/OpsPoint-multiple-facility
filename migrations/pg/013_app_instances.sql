-- ============================================================================
-- 013_app_instances.sql — one row per running server, for the health check
-- (plus an audit_log index the backups check needs)
--
-- Each facility server rewrites its row every minute: host, pid, version, and
-- when each background job (push scheduler, HQ sync, lock sweep, session
-- cleanup, backup) last ran, as JSON. The health check (server/health/) reads
-- it to find stalled timers and a second instance — also from another process
-- (`node server/cli/opspoint.js doctor`). Rows not seen for an hour are pruned.
--
-- SQLite gets the same table from createSchema() in server/db/migrate.js.
-- Additive and idempotent; apply before restarting onto the code that uses it:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/pg/013_app_instances.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS app_instances (
  instance_id text        PRIMARY KEY,
  app         text        NOT NULL DEFAULT 'facility',
  hostname    text        NOT NULL DEFAULT '',
  pid         integer     NOT NULL DEFAULT 0,
  version     text        NOT NULL DEFAULT '',
  started_at  timestamptz NOT NULL,
  last_seen   timestamptz NOT NULL,
  jobs        text        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_app_instances_last_seen ON app_instances (last_seen);

-- The health check finds the newest backup.create / backup.failed entry
-- (written by the app and by scripts/opspoint-backup.sh); without this it
-- walks the whole audit log backwards to find a rare one.
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action, id);

COMMIT;
