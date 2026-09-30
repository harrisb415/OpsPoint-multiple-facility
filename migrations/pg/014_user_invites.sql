-- ============================================================================
-- 014_user_invites.sql — one-time invite links for new accounts
--
-- A new account can set its own password from a link (or its QR code) instead
-- of being handed a temporary one: the setup wizard's staff step, and Admin ›
-- Users. The link carries a random 256-bit token; this table keeps only its
-- SHA-256. used_at marks it spent; a new invite for the same account replaces
-- the old one. Deleting the account deletes its invites.
--
-- SQLite gets the same table from createSchema() in server/db/migrate.js.
-- OpsPoint applies this file itself as it starts (server/db/runner.js).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS user_invites (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    integer     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_user_invites_user ON user_invites (user_id);

COMMIT;
