-- ============================================================================
-- pg-repair-ua-tested-at.sql — one-off repair: UA test times stored hours early
--
-- Until 2026-09-26 the Conduct UA dialog sent tested_at as local wall-clock
-- text with no zone ('2026-09-08T16:42'). Postgres reads zone-less input to a
-- timestamptz column as UTC, so every UA recorded on a Postgres install landed
-- one UTC offset early — 7 hours in PDT. SQLite installs are unaffected: they
-- stored the text and browsers read it back as local time.
--
-- An affected row is recognisable exactly. The dialog stamped tested_at at the
-- moment of saving, and the database sets created_at at insert, so read back
-- as local time in the facility's zone, a broken tested_at lands within two
-- minutes BEFORE created_at. Only rows matching that are touched, so a second
-- run, a correct row, or a row entered any other way is left alone. Each fix
-- is written to audit_log. ua_records and audit_log both sync to HQ, so the
-- corrected rows reach central through the normal outbox.
--
-- Usage — as the app's database role, from the app directory:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v tz='America/Los_Angeles' \
--        -f scripts/pg-repair-ua-tested-at.sql
-- Add  -v apply=0  to see what would change and roll back instead of commit.
-- ============================================================================

\if :{?tz}
\else
  \echo 'Set the facility timezone:  -v tz=America/Los_Angeles'
  \quit
\endif
\if :{?apply}
\else
  \set apply 1
\endif

BEGIN;

CREATE TEMP TABLE ua_fix ON COMMIT DROP AS
SELECT id,
       client_name,
       tested_at                                          AS old_tested_at,
       (tested_at AT TIME ZONE 'UTC') AT TIME ZONE :'tz'  AS new_tested_at,
       created_at
FROM ua_records
WHERE created_at - ((tested_at AT TIME ZONE 'UTC') AT TIME ZONE :'tz')
      BETWEEN interval '0 seconds' AND interval '2 minutes';

SELECT id, client_name, old_tested_at, new_tested_at, created_at FROM ua_fix ORDER BY id;

UPDATE ua_records u SET tested_at = f.new_tested_at FROM ua_fix f WHERE u.id = f.id;

INSERT INTO audit_log (ts, actor_name, ip, action, target_type, target_id, target_label, detail)
SELECT now(), 'maintenance script', 'localhost', 'ua.tested_at_repair', 'ua_record', f.id::text,
       'UA test time corrected (timezone bug)',
       json_build_object('from', f.old_tested_at, 'to', f.new_tested_at, 'tz', :'tz')::text
FROM ua_fix f;

\if :apply
COMMIT;
\echo 'committed'
\else
ROLLBACK;
\echo 'dry run — rolled back'
\endif
