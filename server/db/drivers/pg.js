'use strict';
/**
 * server/db/drivers/pg.js — the PostgreSQL driver (node-postgres).
 *
 * Presents the same run/query/query1 surface as the SQLite driver so the
 * repositories do not care which is underneath. Everything here is async.
 *
 * Four things this file exists to absorb, so 130 call sites do not have to:
 *
 *   1. PLACEHOLDERS.  The codebase writes `?`; PostgreSQL wants `$1, $2`.
 *      Translated here rather than rewritten at every call site, so the same
 *      SQL string keeps working against both drivers.
 *
 *   2. lastInsertRowid.  SQLite hands it back from run(); PostgreSQL needs
 *      RETURNING id. Appended automatically for INSERTs into the tables
 *      that actually have an identity id (IDENTITY_TABLES below) — appending
 *      it blindly would fail on settings, user_groups, sessions and the other
 *      four tables that have no id column.
 *
 *   3. TYPE PARSERS.  Dates stay 'YYYY-MM-DD' text and int8 becomes a number,
 *      as SQLite hands them back. timestamptz becomes ISO-8601 UTC — see the
 *      parser below for why the raw Postgres text was not good enough.
 *
 *   4. TLS.  Defaults to verify-full. PHI crosses DMZ->DATA on every query and
 *      libpq's default `prefer` silently downgrades to plaintext when the
 *      server has no certificate. Failing loudly is the point; set
 *      PGSSLMODE=require explicitly to relax it.
 *
 *   5. TIME ZONE.  Each session runs in the process's own zone, so zone-less
 *      timestamps the app writes (nowLocal(), localShift()) and SQL such as
 *      date(created_at) mean the same local time on both sides.
 */
const { Pool, types } = require('pg');
const settings = require('../../settings');

// ── Type parsers ─────────────────────────────────────────────────────────────
// Stay text: calendar dates ('YYYY-MM-DD', what the date inputs speak),
// timestamps without zone and numerics. Parsing them into Date objects would
// change every response shape.
// 1082 date · 1114 timestamp · 1700 numeric
for (const oid of [1082, 1114, 1700]) {
  types.setTypeParser(oid, (v) => v);
}

// 1184 timestamptz -> ISO-8601 UTC ('2026-09-27T04:22:33.923Z').
//
// Postgres's own text ('2026-09-27 04:22:33.923546+00') names the right moment,
// but the client read it wrong in three ways: timeAgo() appended a 'Z' to the
// '+00' and got an Invalid Date ("NaNd ago", a UA-draw window that matched
// nothing); Safari's Date() rejects the space-separated spelling outright; and
// slicing it for a date or time handed staff UTC values they read as local. ISO
// is the one spelling every consumer parses the same way, and it still sorts as
// text. Output only — how zone-less INPUT is read is the session TimeZone's job.
types.setTypeParser(1184, (v) => {
  if (v == null) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();   // 'infinity' stays as-is
});

// The zone each session runs in: PGTZ if set, else the process's own (TZ).
// Only IANA-shaped names get through, since it becomes a startup option; a
// PGTZ that isn't a zone at all is refused by the startup check, and never
// reaches Postgres from here either.
function sessionTimeZone() {
  let pgtz;
  try { pgtz = settings.get('PGTZ'); } catch (e) { return 'UTC'; }
  const tz = pgtz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return /^[A-Za-z0-9_+\-/]{1,64}$/.test(tz) ? tz : 'UTC';
}

// Put TimeZone in the connection's startup options, so every session begins
// in the process zone before any query runs. (A `SET TIME ZONE` sent from the
// pool's 'connect' event raced the first real query onto the same client,
// which node-postgres deprecates and will reject in pg@9.) Merged into the
// URL's own `options` rather than passed as a config field, because values
// parsed from the connection string override config fields.
function withSessionTimeZone(dsn) {
  try {
    const u = new URL(dsn);
    u.searchParams.set('options', [u.searchParams.get('options'), `-c TimeZone=${sessionTimeZone()}`].filter(Boolean).join(' '));
    return u.toString();
  } catch (e) { return dsn; }
}

// int8 (bigint) is the exception, and it must be a NUMBER.
//
// node-postgres returns bigint as a string by default to protect values above
// 2^53, and COUNT(*) is bigint. Left as a string it breaks silently rather than
// loudly: `cnt.c === 0` is false for "0", so the first-run seed blocks in
// db.js and central/db.js never fire and the app comes up with no accounts and
// no printed credentials. Sums like `a + (b.k || 0)` concatenate instead of
// adding. SQLite returns a number here, so a string is also simply wrong.
//
// Safe because every bigint in this schema is small: counts, SQLite-derived
// row ids (facility_data.source_id, sync_state.applied_through), a file size,
// and sessions.expires_at as epoch ms (~1.7e12). All are orders of magnitude
// below Number.MAX_SAFE_INTEGER. A genuinely large bigint would need its own
// column-level handling — there isn't one.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

// Tables whose id is GENERATED ALWAYS AS IDENTITY (migrations/pg/001+002).
// An INSERT into one of these gets RETURNING id appended so run() can report
// lastInsertRowid. Everything else — settings, user_groups, sessions,
// group_note_attendees, schema_migrations, facilities, managed_users,
// managed_user_facilities, sync_state, facility_data, releases, rollouts —
// has no identity id and must not get the clause.
const IDENTITY_TABLES = new Set([
  'clients', 'reports', 'log_entries', 'users', 'staff', 'passes', 'chore_log',
  'ua_requests', 'mail_log', 'violations', 'groups', 'ua_draws',
  'broadcast_messages', 'audit_log', 'ua_records', 'milestones', 'incidents',
  'discharge_records', 'consent_records', 'disclosures', 'group_sessions',
  'group_attendance', 'sync_outbox', 'clinical_notes', 'treatment_plans',
  'assessments', 'group_notes', 'discharge_summaries',
  'wellness_rounds', 'push_subscriptions', 'device_pins',
  // central
  'central_users', 'audit',
]);

let _pool = null;
let _dsn  = null;

/**
 * `?` -> `$1, $2, ...`, skipping anything inside a single-quoted literal.
 * SQL escapes a quote by doubling it ('' inside a string), which is handled.
 * Dollar-quoting and double-quoted identifiers containing `?` are NOT handled;
 * the codebase uses neither, and a stray `?` in an identifier would be a bug
 * worth failing on rather than silently rewriting.
 */
function toPositional(sql) {
  let out = '', n = 0, inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inString && sql[i + 1] === "'") { out += "''"; i++; continue; }
      inString = !inString;
      out += ch;
      continue;
    }
    if (ch === '?' && !inString) { out += '$' + (++n); continue; }
    out += ch;
  }
  return out;
}

const INSERT_RE = /^\s*INSERT\s+INTO\s+"?([a-z_][a-z0-9_]*)"?/i;

// Append RETURNING id to an INSERT when the target has one and the caller has
// not already asked for something back.
function withReturning(sql) {
  if (/\bRETURNING\b/i.test(sql)) return sql;
  const m = INSERT_RE.exec(sql);
  if (!m || !IDENTITY_TABLES.has(m[1].toLowerCase())) return sql;
  return sql.replace(/;\s*$/, '') + ' RETURNING id';
}

/**
 * dsn: a postgresql:// URL, or undefined to take DATABASE_URL from the
 * environment. Credentials come from the environment — never a tracked file.
 *
 * The argument is filtered, not trusted. Callers pass whatever init() was
 * handed, and under the SQLite driver that is a FILE PATH — db.js calls
 * connection.open(DB_PATH). Accepting it verbatim would build a pool against
 * "/home/hestia/OpsPoint/data/opspoint.db" and fail with a connection error
 * that says nothing about the real cause. So only a string that actually looks
 * like a connection URL is used, and anything else falls back to the
 * environment; with neither, this throws now rather than at the first query.
 */
function open(dsn) {
  const looksLikeDsn = typeof dsn === 'string' && /^postgres(ql)?:\/\//i.test(dsn);
  _dsn = (looksLikeDsn ? dsn : null) || settings.get('DATABASE_URL') || null;
  if (!_dsn) {
    throw new Error(
      'OPSPOINT_DB_DRIVER=pg but no connection string was given. Set DATABASE_URL ' +
      '(and CENTRAL_DATABASE_URL for the HQ server), or pass a postgres:// URL to open().');
  }
  // PGSSLMODE defaults to verify-full; only an explicit disable or require relaxes it.
  const sslMode = settings.get('PGSSLMODE');
  const rootCert = settings.get('PGSSLROOTCERT');
  const ssl = sslMode === 'disable'
    ? false
    : { rejectUnauthorized: sslMode !== 'require',
        ca: rootCert ? require('fs').readFileSync(rootCert, 'utf8') : undefined };

  _pool = new Pool({
    connectionString: _dsn ? withSessionTimeZone(_dsn) : undefined,
    ssl,
    max: settings.get('PGPOOL_MAX'),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'opspoint',
  });

  // A pool error with no listener is an uncaught exception that takes the
  // process down — an idle backend being terminated is routine, not fatal.
  _pool.on('error', (err) => {
    console.error('[pg] idle client error:', err.message);
  });

  return _pool;
}

function getDb()   { return _pool; }
function getPath() { return _dsn; }

// ── Primitives ──────────────────────────────────────────────────────────────
// `exec` runs a client against the pool; `client` lets a transaction reuse one.

async function run(sql, params = [], client = null) {
  const text = withReturning(toPositional(sql));
  const res  = await (client || _pool).query(text, params);
  return {
    changes: res.rowCount,
    // Matches better-sqlite3's shape. Undefined when the statement returned no
    // id, which is exactly when SQLite would not have had one either.
    lastInsertRowid: res.rows && res.rows[0] ? res.rows[0].id : undefined,
  };
}

async function query(sql, params = [], client = null) {
  const res = await (client || _pool).query(toPositional(sql), params);
  return res.rows;
}

async function query1(sql, params = [], client = null) {
  const res = await (client || _pool).query(toPositional(sql), params);
  return res.rows[0] || null;
}

async function exec(sql, client = null) {
  return (client || _pool).query(sql);
}

/**
 * BEGIN/COMMIT on ONE checked-out client — not on the pool, where consecutive
 * statements can land on different backends and the transaction silently means
 * nothing. The callback gets primitives bound to that client.
 */
async function transaction(fn) {
  const client = await _pool.connect();
  try {
    await client.query('BEGIN');
    const scoped = {
      run:    (s, p = []) => run(s, p, client),
      query:  (s, p = []) => query(s, p, client),
      query1: (s, p = []) => query1(s, p, client),
      exec:   (s)         => exec(s, client),
    };
    const out = await fn(scoped);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

// Backups are pg_dump's job, not the application's — and dumping from inside
// the app would put plaintext PHI on the web host's disk. Rejects rather than
// pretending to succeed, so a caller that assumes SQLite semantics fails loudly.
function backupTo() {
  return Promise.reject(new Error(
    'backupTo() is SQLite-only. On PostgreSQL, back up with pg_dump on the ' +
    'database host and encrypt the output; see the deployment runbook.'));
}

async function close() { if (_pool) { await _pool.end(); _pool = null; } }

module.exports = {
  open, getDb, getPath, backupTo, run, query, query1, exec, transaction, close,
  // exported for unit tests
  _toPositional: toPositional, _withReturning: withReturning, _sessionTimeZone: sessionTimeZone,
  _withSessionTimeZone: withSessionTimeZone, IDENTITY_TABLES,
};
