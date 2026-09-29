-- ============================================================================
-- 010_violation_staff_name.sql — the staff member named on an infraction
--
-- Logging an infraction now takes a staff name typed in by hand, like a UA's
-- "Conducted by". logged_by keeps the signed-in account that saved it (and the
-- audit log still records it), so a shared login doesn't hide who was there.
--
-- SQLite gets the same column from runColumnMigrations() in server/db/migrate.js.
-- Additive and idempotent; apply before restarting onto the code that uses it:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/pg/010_violation_staff_name.sql
-- ============================================================================

BEGIN;

ALTER TABLE violations ADD COLUMN IF NOT EXISTS staff_name text NOT NULL DEFAULT '';

COMMIT;
