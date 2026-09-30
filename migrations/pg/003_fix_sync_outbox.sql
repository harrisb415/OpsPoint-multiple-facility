-- ============================================================================
-- 003_fix_sync_outbox.sql — repair the sync outbox
--
-- 001 got this table wrong in two ways, both found by exercising the read paths
-- against a real database rather than by reading the schema.
--
--   1. WRONG COLUMNS. 001 declared (entity, entity_id, payload, sent_at). The
--      application has always used (table_name, row_id, synced_at) — see
--      getSyncBatch/outboxPending/markSynced in db.js. Every read against it
--      failed with `column "table_name" does not exist`.
--
--   2. NO TRIGGERS AT ALL. Under SQLite the outbox is filled by AFTER
--      INSERT/UPDATE/DELETE triggers created at boot by _createSyncLayer().
--      That function is skipped under pg (it emits SQLite-dialect DDL and calls
--      _db.pragma), and 001 shipped no replacement — so the outbox would have
--      stayed permanently empty and no facility would ever have synced to HQ.
--      Silently: nothing errors when a queue is simply never written to.
--
-- Safe to run on a live database: sync_outbox holds only queued deltas, and it
-- cannot hold anything meaningful yet given nothing has ever populated it.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS sync_outbox CASCADE;

CREATE TABLE sync_outbox (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text        NOT NULL,
  row_id     integer     NOT NULL,
  op         text        NOT NULL CHECK (op IN ('upsert','delete')),
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at  timestamptz
);

-- Matches the query in outboxPending/getSyncBatch: unsent rows, oldest first.
CREATE INDEX idx_outbox_unsynced ON sync_outbox (synced_at NULLS FIRST, id);

-- One trigger function for every synced table, rather than SQLite's three
-- statements per table. TG_TABLE_NAME supplies the table, so the body is
-- generic and there is no interpolation to get wrong.
--
-- Postgres fires row triggers on cascaded deletes by default, so a resident
-- removed via ON DELETE CASCADE still produces delete rows for their children.
-- SQLite needed recursive_triggers=ON for the same guarantee.
CREATE OR REPLACE FUNCTION sync_outbox_capture() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO sync_outbox (table_name, row_id, op)
      VALUES (TG_TABLE_NAME, OLD.id, 'delete');
    RETURN OLD;
  ELSE
    INSERT INTO sync_outbox (table_name, row_id, op)
      VALUES (TG_TABLE_NAME, NEW.id, 'upsert');
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Attach to exactly the tables in SYNC_TABLES (db.js). Kept as an explicit list
-- rather than "every table": the outbox mirrors operational rows to HQ, and
-- sweeping in settings/sessions/schema_migrations would leak local state.
DO $$
DECLARE
  t text;
  synced text[] := ARRAY[
    'clients','reports','log_entries','staff','passes','chore_log',
    'ua_requests','mail_log','violations',
    'ua_records','milestones','incidents',
    'discharge_records','consent_records','disclosures',
    'group_sessions','group_attendance','ua_draws','broadcast_messages',
    'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY synced LOOP
    IF to_regclass(format('%I.%I', current_schema(), t)) IS NOT NULL THEN   -- the schema being migrated, not always public
      EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_%I ON %I', t, t);
      EXECUTE format(
        'CREATE TRIGGER trg_sync_%I AFTER INSERT OR UPDATE OR DELETE ON %I '
        'FOR EACH ROW EXECUTE FUNCTION sync_outbox_capture()', t, t);
    END IF;
  END LOOP;
END $$;

COMMIT;
