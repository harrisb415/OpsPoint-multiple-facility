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
    // CREATE TABLE <name> ( ... id integer GENERATED ALWAYS AS IDENTITY
    const re = /CREATE TABLE (\w+)\s*\(([\s\S]*?)\n\);/g;
    let m;
    while ((m = re.exec(sql))) {
      if (/\bGENERATED ALWAYS AS IDENTITY\b/.test(m[2])) out.add(m[1]);
    }
    return out;
  }

  test('every identity table in the DDL is listed in the driver', () => {
    const declared = new Set([
      ...identityTablesInDdl('001_facility_schema.sql'),
      ...identityTablesInDdl('002_central_schema.sql'),
    ]);
    const missing = [...declared].filter((t) => !IDENTITY_TABLES.has(t));
    expect({ missing, count: declared.size }).toEqual({ missing: [], count: declared.size });
  });

  test('the driver lists nothing the DDL does not declare', () => {
    const declared = new Set([
      ...identityTablesInDdl('001_facility_schema.sql'),
      ...identityTablesInDdl('002_central_schema.sql'),
    ]);
    const extra = [...IDENTITY_TABLES].filter((t) => !declared.has(t));
    expect(extra).toEqual([]);
  });
});
