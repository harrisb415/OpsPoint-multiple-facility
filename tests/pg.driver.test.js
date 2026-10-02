'use strict';
/**
 * Unit tests for the Postgres driver's two pure translation functions.
 *
 * These need no database. They are the pieces every one of the ~130 repository
 * call sites depends on: get the placeholder rewrite wrong and queries fail in
 * ways that look like application bugs; get RETURNING wrong and either
 * lastInsertRowid comes back undefined or the INSERT fails on a table with no
 * id column.
 */
const pg = require('../server/db/drivers/pg');
const { _toPositional: toPositional, _withReturning: withReturning, IDENTITY_TABLES } = pg;

describe('? -> $n placeholder translation', () => {
  test('numbers placeholders in order', () => {
    expect(toPositional('SELECT * FROM users WHERE id=? AND role=?'))
      .toBe('SELECT * FROM users WHERE id=$1 AND role=$2');
  });

  test('leaves SQL without placeholders alone', () => {
    expect(toPositional('SELECT count(*) FROM clients'))
      .toBe('SELECT count(*) FROM clients');
  });

  test('does not touch a ? inside a string literal', () => {
    expect(toPositional("SELECT * FROM t WHERE note='what?' AND id=?"))
      .toBe("SELECT * FROM t WHERE note='what?' AND id=$1");
  });

  test('handles the doubled-quote escape inside a literal', () => {
    // 'it''s a ? here' is one literal containing an apostrophe and a question
    // mark; only the trailing placeholder may be rewritten.
    expect(toPositional("UPDATE t SET x='it''s a ? here' WHERE id=?"))
      .toBe("UPDATE t SET x='it''s a ? here' WHERE id=$1");
  });

  test('numbers many placeholders correctly (INSERT shape used across repos)', () => {
    const sql = 'INSERT INTO staff (category,name,phone,phone2,notes,sort_order) VALUES (?,?,?,?,?,?)';
    expect(toPositional(sql))
      .toBe('INSERT INTO staff (category,name,phone,phone2,notes,sort_order) VALUES ($1,$2,$3,$4,$5,$6)');
  });

  test('reused values still get distinct positions', () => {
    // Postgres allows $1 twice, but the caller passes a flat params array, so
    // each ? must consume its own slot to stay aligned with better-sqlite3.
    expect(toPositional('SELECT * FROM t WHERE a=? OR b=?'))
      .toBe('SELECT * FROM t WHERE a=$1 OR b=$2');
  });
});

describe('RETURNING id', () => {
  test('appended for an INSERT into an identity table', () => {
    expect(withReturning('INSERT INTO clients (room,name) VALUES ($1,$2)'))
      .toBe('INSERT INTO clients (room,name) VALUES ($1,$2) RETURNING id');
  });

  test('NOT appended for a table with no id column', () => {
    const sql = 'INSERT INTO settings (key,value) VALUES ($1,$2)';
    expect(withReturning(sql)).toBe(sql);
  });

  test('NOT appended for the composite-key join tables', () => {
    for (const t of ['user_groups', 'group_note_attendees', 'sessions', 'schema_migrations']) {
      const sql = `INSERT INTO ${t} (a,b) VALUES ($1,$2)`;
      expect(withReturning(sql)).toBe(sql);
    }
  });

  test('NOT appended for central tables with TEXT uuid keys', () => {
    for (const t of ['facilities', 'managed_users']) {
      const sql = `INSERT INTO ${t} (id,name) VALUES ($1,$2)`;
      expect(withReturning(sql)).toBe(sql);
    }
  });

  test('respects a RETURNING the caller already wrote', () => {
    const sql = 'INSERT INTO clients (room) VALUES ($1) RETURNING id, room';
    expect(withReturning(sql)).toBe(sql);
  });

  test('strips a trailing semicolon before appending', () => {
    expect(withReturning('INSERT INTO passes (client_id) VALUES ($1);'))
      .toBe('INSERT INTO passes (client_id) VALUES ($1) RETURNING id');
  });

  test('left alone for non-INSERT statements', () => {
    for (const sql of ['UPDATE clients SET room=$1 WHERE id=$2',
                       'DELETE FROM clients WHERE id=$1',
                       'SELECT * FROM clients']) {
      expect(withReturning(sql)).toBe(sql);
    }
  });

  test('tolerates leading whitespace and mixed case', () => {
    expect(withReturning('  insert into reports (shift) values ($1)'))
      .toBe('  insert into reports (shift) values ($1) RETURNING id');
  });
});

describe('identity table list matches the shipped DDL', () => {
  // Guards against the list drifting from migrations/pg/*.sql. A table added to
  // the schema with an identity id but missing here silently loses
  // lastInsertRowid; one added here by mistake breaks its INSERTs outright.
  const fs = require('fs');
  const path = require('path');

  function identityTablesInDdl(file) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'pg', file), 'utf8');
    const out = new Set();
    // CREATE TABLE [IF NOT EXISTS] <name> ( ... id integer GENERATED ALWAYS AS IDENTITY
    const re = /CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\);/g;
    let m;
    while ((m = re.exec(sql))) {
      if (/\bGENERATED ALWAYS AS IDENTITY\b/.test(m[2])) out.add(m[1]);
    }
    return out;
  }

  // Every migration, not just 001/002: later ones add tables too (007).
  function declaredIdentityTables() {
    const dir = path.join(__dirname, '..', 'migrations', 'pg');
    const out = new Set();
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.sql'))) {
      for (const t of identityTablesInDdl(f)) out.add(t);
    }
    return out;
  }

  test('every identity table in the DDL is listed in the driver', () => {
    const declared = declaredIdentityTables();
    const missing = [...declared].filter((t) => !IDENTITY_TABLES.has(t));
    expect({ missing, count: declared.size }).toEqual({ missing: [], count: declared.size });
  });

  test('the driver lists nothing the DDL does not declare', () => {
    const declared = declaredIdentityTables();
    const extra = [...IDENTITY_TABLES].filter((t) => !declared.has(t));
    expect(extra).toEqual([]);
  });
});

// ── Connection-string handling ──────────────────────────────────────────────
// db.js calls connection.open(DB_PATH), and under the sqlite driver DB_PATH is
// a file path. If the pg driver took that verbatim it would build a pool
// against "…/data/opspoint.db" and fail at the first query with an error that
// says nothing about the real cause. This is the cutover's sharpest edge: it
// only appears when OPSPOINT_DB_DRIVER flips to pg.
describe('open() connection string', () => {
  const pg = require('../server/db/drivers/pg');
  const saved = process.env.DATABASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  });

  test('refuses a file path and says what to set', () => {
    delete process.env.DATABASE_URL;
    expect(() => pg.open('/home/hestia/OpsPoint/data/opspoint.db'))
      .toThrow(/DATABASE_URL/);
  });

  test('accepts a postgres:// URL', () => {
    pg.open('postgresql://u:p@localhost:5432/opspoint');
    expect(pg.getPath()).toBe('postgresql://u:p@localhost:5432/opspoint');
  });

  test('falls back to DATABASE_URL when handed a path', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@db-mnemosyne/opspoint';
    pg.open('/some/sqlite/path.db');
    expect(pg.getPath()).toBe('postgresql://u:p@db-mnemosyne/opspoint');
  });
});

// ── Type parsers ────────────────────────────────────────────────────────────
// COUNT(*) is bigint, and node-postgres returns bigint as a string by default.
// Left that way it fails silently rather than loudly: `cnt.c === 0` is false for
// "0", so the first-run seed blocks in db.js and central/db.js never run and the
// app comes up with no accounts and no printed credentials — which is exactly
// what happened on the first Central bring-up against real Postgres.
describe('type parsers', () => {
  const types = require('pg').types;
  require('../server/db/drivers/pg');   // registers the parsers on load

  test('bigint (int8) parses to a number, so COUNT(*) comparisons work', () => {
    const parse = types.getTypeParser(20);
    expect(parse('0')).toBe(0);
    expect(parse('42')).toBe(42);
    expect(typeof parse('7')).toBe('number');
    // The failure this guards: a seed gate written as `=== 0`.
    expect(parse('0') === 0).toBe(true);
  });

  test('bigint values in this schema stay exactly representable', () => {
    const parse = types.getTypeParser(20);
    const epochMs = 1757308800000;            // sessions.expires_at magnitude
    expect(parse(String(epochMs))).toBe(epochMs);
    expect(parse(String(epochMs))).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  test('calendar dates and zone-less timestamps stay text', () => {
    expect(types.getTypeParser(1082)('2026-09-08')).toBe('2026-09-08');
    expect(types.getTypeParser(1114)('2026-09-08 12:00:00')).toBe('2026-09-08 12:00:00');
  });

  // Postgres's own timestamptz text broke the client three ways (a Z appended
  // to '+00', Safari rejecting the space, UTC read off by slicing). ISO UTC is
  // the one spelling everything parses alike — whatever zone the session is in.
  test('timestamptz becomes ISO-8601 UTC, from any session offset', () => {
    const parse = types.getTypeParser(1184);
    expect(parse('2026-09-27 04:22:33.923546+00')).toBe('2026-09-27T04:22:33.923Z');
    expect(parse('2026-09-26 21:22:33+00')).toBe('2026-09-26T21:22:33.000Z');
    expect(parse('2026-09-26 21:22:33.5-07')).toBe('2026-09-27T04:22:33.500Z');
    expect(parse('infinity')).toBe('infinity');
    expect(parse(null)).toBe(null);
  });

  // A startup option, not a SET query: a SET fired from the pool's connect
  // event raced the first real query onto the same client (deprecated in pg 8,
  // rejected in pg 9). It must keep any options the URL already carries.
  test('the session time zone rides in the connection options, keeping existing ones', () => {
    const { _withSessionTimeZone } = require('../server/db/drivers/pg');
    const parse = require('pg-connection-string').parse || require('pg-connection-string');
    const saved = process.env.PGTZ;
    try {
      process.env.PGTZ = 'America/Los_Angeles';
      const a = parse(_withSessionTimeZone('postgresql://u:p%40ss@db:5432/opspoint'));
      expect(a.options).toBe('-c TimeZone=America/Los_Angeles');
      expect(a.password).toBe('p@ss');
      const b = parse(_withSessionTimeZone('postgresql://u:p@db:5432/x?options=-c%20search_path%3Dcentral_test'));
      expect(b.options).toBe('-c search_path=central_test -c TimeZone=America/Los_Angeles');
      // A socket URL with no host (Cloud SQL's) keeps its zone and its socket.
      const s = _withSessionTimeZone('postgresql://opspoint@/opspoint?host=/cloudsql/p:us-west1:db');
      expect(s.startsWith('postgresql://opspoint@/opspoint?')).toBe(true);
      expect(parse(s)).toMatchObject({ host: '/cloudsql/p:us-west1:db', database: 'opspoint', options: '-c TimeZone=America/Los_Angeles' });
    } finally {
      if (saved === undefined) delete process.env.PGTZ; else process.env.PGTZ = saved;
    }
  });

  test('the session time zone follows PGTZ, then the process, and rejects junk', () => {
    const { _sessionTimeZone } = require('../server/db/drivers/pg');
    const saved = process.env.PGTZ;
    try {
      process.env.PGTZ = 'America/Los_Angeles';
      expect(_sessionTimeZone()).toBe('America/Los_Angeles');
      process.env.PGTZ = "UTC'; DROP TABLE users; --";
      expect(_sessionTimeZone()).toBe('UTC');
      delete process.env.PGTZ;
      expect(_sessionTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } finally {
      if (saved === undefined) delete process.env.PGTZ; else process.env.PGTZ = saved;
    }
  });
});

// ── Schema/driver agreement on flag columns ─────────────────────────────────
// The app stores 0/1 on both drivers and the JSON API returns 0/1. A boolean
// column in the Postgres schema breaks every write to it — Postgres will not
// coerce an integer to boolean — and would make the two drivers return
// different types for the same field. Caught only on a real server, so this
// guards the schema file itself.
describe('flag columns are 0/1, not boolean', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'migrations', 'pg');

  for (const file of ['001_facility_schema.sql', '002_central_schema.sql']) {
    test(`${file} declares no boolean columns`, () => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const cols = sql.split('\n')
        .filter((l) => /^\s+[a-z_]+\s+boolean\b/.test(l))
        .map((l) => l.trim());
      expect(cols).toEqual([]);
    });

    test(`${file} constrains every flag column to (0,1)`, () => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const unconstrained = sql.split('\n')
        .filter((l) => /^\s+(is_|must_|has_|acknowledged|revoked|present|central_managed|signature_on_file)/.test(l))
        .filter((l) => /\bsmallint\b/.test(l))
        .filter((l) => !/CHECK \([a-z_]+ IN \(0,1\)\)/.test(l))
        .map((l) => l.trim());
      expect(unconstrained).toEqual([]);
    });
  }
});
