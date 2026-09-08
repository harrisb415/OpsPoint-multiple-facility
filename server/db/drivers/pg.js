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
 *      RETURNING id. Appended automatically for INSERTs into the 28 tables
 *      that actually have an identity id (IDENTITY_TABLES below) — appending
 *      it blindly would fail on settings, user_groups, sessions and the other
 *      four tables that have no id column.
 *
 *   3. TYPE PARSERS.  node-postgres turns timestamptz into a JS Date, which
 *      would change /api/data's wire format from '2026-09-08 01:29:00' to
 *      '2026-09-08T01:29:00.000Z' the moment it is JSON.stringify'd — a
 *      client-visible change for a database port that should be invisible.
 *      Dates, timestamps and int8 are pinned to strings to match SQLite byte
 *      for byte. int8 matters separately: JS cannot hold every bigint exactly,
 *      and node-postgres returns it as a string for that reason.
 *
 *   4. TLS.  Defaults to verify-full. PHI crosses DMZ->DATA on every query and
 *      libpq's default `prefer` silently downgrades to plaintext when the
 *      server has no certificate. Failing loudly is the point; set
 *      PGSSLMODE=require explicitly to relax it.
 */
const { Pool, types } = require('pg');

// ── Type parsers: keep the wire format identical to SQLite ──────────────────
// 1082 date · 1114 timestamp · 1184 timestamptz · 20 int8 · 1700 numeric
for (const oid of [1082, 1114, 1184, 20, 1700]) {
  types.setTypeParser(oid, (v) => v);
}

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
  _dsn = (looksLikeDsn ? dsn : null) || process.env.DATABASE_URL || null;
  if (!_dsn) {
    throw new Error(
      'OPSPOINT_DB_DRIVER=pg but no connection string was given. Set DATABASE_URL ' +
      '(and CENTRAL_DATABASE_URL for the HQ server), or pass a postgres:// URL to open().');
  }
  const ssl = process.env.PGSSLMODE === 'disable'
    ? false
    : { rejectUnauthorized: process.env.PGSSLMODE !== 'require',
        ca: process.env.PGSSLROOTCERT ? require('fs').readFileSync(process.env.PGSSLROOTCERT, 'utf8') : undefined };

  _pool = new Pool({
    connectionString: _dsn || undefined,
    ssl,
    max: parseInt(process.env.PGPOOL_MAX, 10) || 10,
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
  _toPositional: toPositional, _withReturning: withReturning, IDENTITY_TABLES,
};
