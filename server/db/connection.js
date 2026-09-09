'use strict';
/**
 * server/db/connection.js — the storage seam.
 *
 * The ONLY file that decides which database driver is in play. Other code talks
 * to storage through the run/query/query1 primitives re-exported here (and, for
 * the parts of db.js not yet split into repositories, through the shared handle
 * from getDb()).
 *
 * Selected by OPSPOINT_DB_DRIVER:
 *   sqlite  (default) — better-sqlite3-multiple-ciphers, encrypted, on-disk
 *   pg                — PostgreSQL over the network via node-postgres
 *
 * WHY BOTH DRIVERS CAN SHARE ONE SET OF CALL SITES
 *   The SQLite primitives are synchronous and return plain values; the Postgres
 *   ones return promises. `await` on a non-promise is a no-op, so a call site
 *   written as
 *       const row = await c.query1('SELECT ...', [id]);
 *   is correct under BOTH. That is what makes SQLite a live rollback rather than
 *   a branch that rots: the same code runs on either driver, chosen at boot.
 *
 *   The corollary is that every caller must await, including under SQLite where
 *   it looks unnecessary. It is not — it is what keeps the two paths identical.
 *
 * WHAT IS NOT PORTABLE
 *   backupTo() is SQLite-only (VACUUM INTO). The Postgres driver rejects it
 *   rather than silently doing nothing; backups there are pg_dump's job, run on
 *   the database host.
 */
const DRIVER = (process.env.OPSPOINT_DB_DRIVER || 'sqlite').toLowerCase();

if (DRIVER !== 'sqlite' && DRIVER !== 'pg') {
  throw new Error(
    `OPSPOINT_DB_DRIVER must be 'sqlite' or 'pg' (got '${DRIVER}'). ` +
    'Refusing to guess which database to open.');
}

const impl = DRIVER === 'pg'
  ? require('./drivers/pg')
  : require('./drivers/sqlite');

/**
 * ORDER BY fragment for sorting a roster by room number.
 *
 * The one query shape that genuinely cannot be spelled the same way on both
 * drivers. `CAST(room AS INTEGER)` is a live landmine on Postgres: SQLite
 * silently yields 0 for a non-numeric room like '101A', Postgres raises and
 * takes the whole roster query with it. So the pg schema carries a generated
 * `room_sort` column (NULL for non-numeric rooms) with a matching index on
 * (room_sort NULLS LAST, room).
 *
 * The two orderings are not identical, deliberately: a non-numeric room sorts
 * FIRST under SQLite (CAST gives 0) and LAST under Postgres. Every production
 * room is numeric today, so nothing moves; NULLS LAST is the better behaviour
 * and matches the index, which is worth more than bug-for-bug parity.
 *
 * Pass the column, qualified if needed: roomOrder('c.room') -> 'c.room_sort ...'.
 */
function roomOrder(col = 'room') {
  return DRIVER === 'pg' ? `${col}_sort NULLS LAST` : `CAST(${col} AS INTEGER)`;
}

/**
 * Clause required to write an explicit id into a GENERATED ALWAYS AS IDENTITY
 * column. Postgres refuses such an INSERT outright — "cannot insert a
 * non-DEFAULT value into column id" — where SQLite simply accepts it. Empty
 * string on SQLite, so the same statement works on both.
 *
 * Goes between the column list and VALUES:
 *   INSERT INTO reports (id, …) ${c.overriding()}VALUES (?, …)
 *
 * Only two statements need it, both restore paths that carry an id supplied by
 * the caller rather than letting the database assign one. Note that these do
 * NOT advance the identity sequence: after a bulk restore, the sequence has to
 * be reset or the next generated id collides. That belongs with the restore
 * tooling, not here.
 */
function overriding() {
  return DRIVER === 'pg' ? 'OVERRIDING SYSTEM VALUE ' : '';
}

/**
 * Read one field out of a JSON document stored in a text column, AS TEXT.
 *
 * Central's facility_data.data holds the row payload a facility synced up.
 * SQLite reads it with json_extract(); Postgres has no such function and needs
 * the column cast to jsonb first.
 *
 * Both sides are forced to text on purpose. json_extract() returns a native
 * value, so on SQLite `json_extract(data,'$.is_active') = '1'` is FALSE — the
 * integer 1 does not equal the string '1' under SQLite's type affinity rules —
 * while Postgres's ->> always yields text and would need the quoted literal.
 * Casting on the SQLite side means every caller quotes its literal and the same
 * condition means the same thing on both drivers.
 */
function jsonText(col, key) {
  return DRIVER === 'pg'
    ? `(${col}::jsonb->>'${key}')`
    : `CAST(json_extract(${col},'$.${key}') AS TEXT)`;
}

/**
 * Case-insensitive LIKE.
 *
 * A quiet incompatibility: SQLite's LIKE is case-INSENSITIVE for ASCII, while
 * Postgres's is case-SENSITIVE. So a free-text search that matched "Brendan"
 * for the query "brendan" under SQLite silently returns nothing under Postgres.
 * Nothing errors; the box just stops finding things.
 *
 * Use for user-supplied search text. A LIKE against a fixed, app-generated
 * marker (an action prefix, a log sentinel) does not need this and should stay
 * plain LIKE, where case-sensitivity is correct.
 */
function ilike() {
  return DRIVER === 'pg' ? 'ILIKE' : 'LIKE';
}

module.exports = {
  driver: DRIVER,
  isPg:   DRIVER === 'pg',
  roomOrder,
  jsonText,
  ilike,
  overriding,

  open:     (...a) => impl.open(...a),
  getDb:    ()     => impl.getDb(),
  getPath:  ()     => impl.getPath(),
  backupTo: (...a) => impl.backupTo(...a),

  run:         (...a) => impl.run(...a),
  query:       (...a) => impl.query(...a),
  query1:      (...a) => impl.query1(...a),
  exec:        (...a) => impl.exec(...a),
  transaction: (...a) => impl.transaction(...a),
  close:       ()     => impl.close(),
};
