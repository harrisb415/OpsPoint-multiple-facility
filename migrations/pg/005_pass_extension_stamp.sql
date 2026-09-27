-- ============================================================================
-- 005_pass_extension_stamp.sql — record the latest extension on the pass
--
-- Extending a pass already appends a line to passes.notes, but that is free
-- text anyone with passes.edit can rewrite. These columns hold the latest
-- extension as data: when it happened, who did it, and the return time it
-- replaced. The "pass extended" notification (permission
-- passes.notify_extended) reads them; SQLite gets the same columns from
-- COLUMN_MIGRATIONS in server/db/migrate.js.
--
-- Additive and idempotent. The running app never reads these columns until
-- the matching code is deployed, so this can be applied before the restart.
-- ============================================================================

BEGIN;

ALTER TABLE passes
  ADD COLUMN IF NOT EXISTS extended_at   timestamptz,
  ADD COLUMN IF NOT EXISTS extended_by   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS extended_from timestamptz;

COMMIT;
