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

module.exports = {
  driver: DRIVER,
  isPg:   DRIVER === 'pg',

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
