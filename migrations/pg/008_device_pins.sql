-- ============================================================================
-- 008_device_pins.sql — quick unlock with a PIN on the mobile app
--
-- After the idle sign-out a phone can unlock with a 6-digit PIN instead of the
-- full password. The phone keeps a random 256-bit token in an httpOnly cookie;
-- this table holds only the token's SHA-256 and the PIN's PBKDF2 hash, so a PIN
-- alone (or a copy of this table) signs no one in. Five wrong PINs delete the
-- row; so do signing out, changing the password, and 30 days unused.
--
-- SQLite gets the same table from createSchema() in server/db/migrate.js.
-- Additive and idempotent; apply before restarting onto the code that uses it:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f migrations/pg/008_device_pins.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS device_pins (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      integer     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  pin_hash     text        NOT NULL,
  pin_salt     text        NOT NULL,
  failures     integer     NOT NULL DEFAULT 0,
  user_agent   text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_pins_user ON device_pins (user_id);

COMMIT;
