-- ============================================================================
-- 004_resync_identity_sequences.sql — repair identity sequences
--
-- Postgres does NOT advance a table's identity sequence when a row is inserted
-- with an explicit id via OVERRIDING SYSTEM VALUE. 001's own NOTE ON IDENTITY
-- flagged this and the follow-up was never implemented, so any table that
-- received a restore-path insert has a sequence pointing at an id already taken.
--
-- It fails late and somewhere else, which is what makes it nasty: the restore
-- succeeds, and the NEXT ordinary insert dies with
--   duplicate key value violates unique constraint "reports_pkey"
-- On this database that meant creating a new shift report was impossible, while
-- everything else looked healthy.
--
-- The code now calls connection.resyncSequence() after each explicit-id insert.
-- This repairs whatever is already skewed.
--
-- Idempotent and safe on a live database: it only moves sequences FORWARD to
-- max(id)+1, never backwards, so it cannot hand out an id that is already used.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  r        record;
  next_id  bigint;
  fixed    int := 0;
  checked  int := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, pg_get_serial_sequence(c.relname, 'id') AS seq
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
      AND pg_get_serial_sequence(c.relname, 'id') IS NOT NULL
    ORDER BY c.relname
  LOOP
    checked := checked + 1;
    EXECUTE format('SELECT COALESCE(MAX(id), 0) + 1 FROM %I', r.tbl) INTO next_id;

    -- Only ever move forward. last_value can legitimately sit ahead of max(id)
    -- when rows have been deleted, and pulling it back would reissue live ids.
    IF next_id > (SELECT last_value FROM pg_sequences
                  WHERE schemaname = 'public' AND sequencename = split_part(r.seq, '.', 2))
    THEN
      PERFORM setval(r.seq, next_id, false);
      fixed := fixed + 1;
      RAISE NOTICE 'resynced %: next id = %', r.tbl, next_id;
    END IF;
  END LOOP;
  RAISE NOTICE 'checked % sequences, resynced %', checked, fixed;
END $$;

COMMIT;
