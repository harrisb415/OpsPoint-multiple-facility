-- ============================================================================
-- 012_void_incidents_violations.sql — incident reports and infractions are
-- voided, never deleted
--
-- Like UA results (009): a mistaken incident report or infraction is voided by
-- someone holding incidents.void / violations.void, with a reason. The record
-- stays, with status 'voided' and who voided it, when and why; the audit log
-- has the same. incidents.delete and violations.delete become the void
-- permissions for whoever held them (PERM_RENAMES in db.js, on boot).
--
-- SQLite gets the same columns from runColumnMigrations() in server/db/migrate.js.
-- Additive and idempotent; apply before restarting onto the code that uses it:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/pg/012_void_incidents_violations.sql
-- ============================================================================

BEGIN;

ALTER TABLE incidents  ADD COLUMN IF NOT EXISTS voided_at      timestamptz;
ALTER TABLE incidents  ADD COLUMN IF NOT EXISTS voided_by_id   integer;
ALTER TABLE incidents  ADD COLUMN IF NOT EXISTS voided_by_name text NOT NULL DEFAULT '';
ALTER TABLE incidents  ADD COLUMN IF NOT EXISTS void_reason    text NOT NULL DEFAULT '';

ALTER TABLE violations ADD COLUMN IF NOT EXISTS voided_at      timestamptz;
ALTER TABLE violations ADD COLUMN IF NOT EXISTS voided_by_id   integer;
ALTER TABLE violations ADD COLUMN IF NOT EXISTS voided_by_name text NOT NULL DEFAULT '';
ALTER TABLE violations ADD COLUMN IF NOT EXISTS void_reason    text NOT NULL DEFAULT '';

COMMIT;
