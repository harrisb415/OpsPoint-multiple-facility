-- ============================================================================
-- 009_ua_void.sql — UA results are voided, never deleted
--
-- A mistaken UA result is voided with a reason by someone holding ua.void: the
-- record stays on file, marked with who voided it, when and why, and so does
-- its line in the shift log (and the photo of the cup on that line). Nothing
-- deletes either any more.
--
-- SQLite gets the same columns from runColumnMigrations() in server/db/migrate.js.
-- Additive and idempotent; apply before restarting onto the code that uses it:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/pg/009_ua_void.sql
-- ============================================================================

BEGIN;

ALTER TABLE ua_records  ADD COLUMN IF NOT EXISTS voided_at      timestamptz;
ALTER TABLE ua_records  ADD COLUMN IF NOT EXISTS voided_by_id   integer;
ALTER TABLE ua_records  ADD COLUMN IF NOT EXISTS voided_by_name text NOT NULL DEFAULT '';
ALTER TABLE ua_records  ADD COLUMN IF NOT EXISTS void_reason    text NOT NULL DEFAULT '';

ALTER TABLE log_entries ADD COLUMN IF NOT EXISTS voided_at      timestamptz;
ALTER TABLE log_entries ADD COLUMN IF NOT EXISTS voided_by_id   integer;
ALTER TABLE log_entries ADD COLUMN IF NOT EXISTS voided_by_name text NOT NULL DEFAULT '';
ALTER TABLE log_entries ADD COLUMN IF NOT EXISTS void_reason    text NOT NULL DEFAULT '';

COMMIT;
