-- ============================================================================
-- 006_central_facility_update_columns.sql — HQ (opscentral) — apply with
-- CENTRAL_DATABASE_URL, NOT the facility database.
--
-- The SQLite HQ schema grows facilities.upd_* through central/db.js
-- _migrate() — what each facility last reported about applying an update.
-- 002 was written from the CREATE TABLE and never got them, so on Postgres
-- every query naming them failed: the HQ facility list and facility detail
-- (listFacilities / getFacility select upd_state), every facility's update
-- report (recordFacilityUpdateStatus), rollout directives and evaluateRollout.
-- Found by the schema diff and tests/central.tour.test.js run against real
-- Postgres; production had logged it once, the first time the list was opened.
--
-- Additive and idempotent: safe on a live database, and a no-op once applied.
-- ============================================================================

BEGIN;

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS upd_state       text NOT NULL DEFAULT '',   -- ''|updating|updated|failed|rolled_back
  ADD COLUMN IF NOT EXISTS upd_attempted   text NOT NULL DEFAULT '',   -- version it last tried
  ADD COLUMN IF NOT EXISTS upd_error       text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS upd_reported_at timestamptz;

COMMIT;
