'use strict';
/**
 * SQLite-backed express-session store.
 *
 * express-session's default MemoryStore is documented as unfit for production:
 * it leaks (nothing ever reaps expired sessions) and it holds every session in
 * process memory, so a restart signs everyone out. That second property is the
 * sharp edge here — the auto-updater restarts the server to apply an update,
 * which would drop every logged-in staff member mid-shift.
 *
 * Sessions live in the main database, so they inherit its SQLCipher encryption
 * at rest along with everything else (a session row carries a user id, display
 * name and permission set).
 *
 * No new dependency: this is the express-session Store contract implemented
 * over the existing connection primitives.
 */
const session = require('express-session');
const jobs = require('./jobs');

const PRUNE_INTERVAL_MS = 15 * 60 * 1000;

// Absolute expiry, in epoch ms, for a session about to be written. Cookie
// expiry survives the JSON round-trip as an ISO string, hence the re-parse.
function expiryOf(sess, fallbackMs) {
  const c = sess && sess.cookie;
  if (c && c.expires) {
    const t = new Date(c.expires).getTime();
    if (!isNaN(t)) return t;
  }
  if (c && typeof c.originalMaxAge === 'number') return Date.now() + c.originalMaxAge;
  return Date.now() + fallbackMs;
}

/**
 * @param conn        server/db/connection (the module, not the handle — its
 *                    primitives resolve the live handle at call time, so this
 *                    can be constructed before db.init()).
 * @param fallbackMs  TTL applied when a session carries no cookie expiry.
 */
function createSessionStore(conn, fallbackMs) {
  class SqliteStore extends session.Store {
    // Every method here is async because the connection is: under Postgres the
    // primitives return promises, and under SQLite they return values, which
    // await passes straight through. express-session's Store contract is
    // callback-based and does not care when the callback fires, so awaiting
    // inside and calling cb afterwards satisfies both drivers.
    //
    // These were plain synchronous calls until the Postgres port, and missing
    // the await here does NOT throw — it silently breaks login. `row` becomes a
    // pending Promise, so `row.expires_at` is undefined, `undefined <= now` is
    // false (NaN comparison), and JSON.parse(undefined) lands in the catch that
    // returns "no session". The user gets bounced back to the login screen with
    // no error anywhere.
    async get(sid, cb) {
      let row;
      try { row = await conn.query1('SELECT data,expires_at FROM sessions WHERE sid=?', [sid]); }
      catch (e) { return cb(e); }
      if (!row) return cb(null, null);
      if (Number(row.expires_at) <= Date.now()) {   // expired — indistinguishable from absent
        try { await conn.run('DELETE FROM sessions WHERE sid=?', [sid]); } catch (e) {}
        return cb(null, null);
      }
      let parsed;
      try { parsed = JSON.parse(row.data); }
      catch (e) { return cb(null, null); }  // corrupt row — force a fresh session
      cb(null, parsed);
    }

    async set(sid, sess, cb) {
      try {
        await conn.run(
          'INSERT INTO sessions (sid,data,expires_at) VALUES (?,?,?) ' +
          'ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at',
          [sid, JSON.stringify(sess), expiryOf(sess, fallbackMs)]
        );
      } catch (e) { return cb(e); }
      cb(null);
    }

    // Rolling-expiry refresh. Never writes session data, only the deadline.
    async touch(sid, sess, cb) {
      try { await conn.run('UPDATE sessions SET expires_at=? WHERE sid=?', [expiryOf(sess, fallbackMs), sid]); }
      catch (e) { return cb(e); }
      cb(null);
    }

    async destroy(sid, cb) {
      try { await conn.run('DELETE FROM sessions WHERE sid=?', [sid]); }
      catch (e) { return cb(e); }
      cb(null);
    }

    async length(cb) {
      try {
        const r = await conn.query1('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', [Date.now()]);
        cb(null, r ? Number(r.n) : 0);
      } catch (e) { cb(e); }
    }

    async clear(cb) {
      try { await conn.run('DELETE FROM sessions', []); } catch (e) { return cb(e); }
      cb(null);
    }

    // Reap expired rows. MemoryStore never did this; a DB-backed store must.
    async prune() {
      try { return (await conn.run('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()])).changes; }
      catch (e) { return 0; }
    }
  }

  const store = new SqliteStore();
  // unref: a background reaper must never be the reason the process stays up.
  // Reported to the health check (server/lib/jobs.js) each time it runs.
  jobs.register('session-prune', PRUNE_INTERVAL_MS, 'Session cleanup');
  const timer = setInterval(async () => { await store.prune(); jobs.beat('session-prune'); }, PRUNE_INTERVAL_MS);
  if (timer.unref) timer.unref();
  store.pruneTimer = timer;
  return store;
}

module.exports = { createSessionStore, expiryOf };
