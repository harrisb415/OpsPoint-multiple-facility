'use strict';
/**
 * server/archive — export and import (deployment plan phase 7).
 *
 *   export  every table and every photo of an install, in one encrypted,
 *           versioned file (format.js), with a manifest of counts and checksums
 *   import  that file into a NEW install of any profile: SQLite to Postgres or
 *           the reverse, photos into the target's file storage. It refuses an
 *           export from a newer OpsPoint, loads everything in one transaction,
 *           and counts every table before and after it commits.
 * The command line (server/cli/opspoint.js) adds `drill`: import into a
 * scratch install and run the health check there — the disaster-recovery test.
 *
 * Inside the encryption, in this order:
 *   header.json           who wrote it (app, version, source database, profile,
 *                         time zone, facility) and each table's columns, in the
 *                         order tables load (parents before the rows that point
 *                         at them: columns.js FK_EDGES)
 *   tables/<name>.jsonl   one JSON array per row, in the header's column order;
 *                         instants as ISO UTC, dates as YYYY-MM-DD (columns.js)
 *   photos/<name>         every file under photos/ in the source's storage
 *   manifest.json         rows per table, sha256 + size of every entry, one
 *                         checksum over them, and anything that could not be
 *                         carried as it was (a time that isn't one)
 * Not carried: the server's own bookkeeping and what belongs to one machine or
 * device (columns.js EXCLUDED_TABLES, MACHINE_SETTINGS), the one-time setup
 * code, and — unless asked for — the link to HQ, so a copy never reports to HQ
 * as the facility it was copied from.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const { createWriter, openReader, ArchiveError, FORMAT, NAME_RE } = require('./format');
const C = require('./columns');

const APP = 'opspoint-facility';
const APP_VERSION = require('../../package.json').version;
const PAGE = 1000;          // rows per read
const BATCH = 250;          // rows per INSERT (29 columns at most: far below either database's limit)
const SEEDED = ['settings', 'groups', 'audit_log'];   // what a new install writes before anyone signs in
const DEFAULT = Symbol('the column default');         // a VALUES cell spelled DEFAULT (Postgres)
const SETUP_CODE_FIELDS = ['code_hash', 'code_salt', 'code_created', 'code_expires'];

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
function q(name) {
  if (!IDENT.test(name)) throw new ArchiveError(`Not a name OpsPoint uses: ${name}`);
  return `"${name}"`;
}

// '2.7.0' vs '2.10.1': -1, 0 or 1.
function compareVersions(a, b) {
  const parts = (v) => String(v || '').split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

// ── The schema, as the database itself describes it ────────────────────────
// Map name -> { name, columns: [{ name, type, notNull, dflt, generated, identity }], pk: [..], fks: [{ col, parent }] }
async function describe(conn, isPg) {
  const tables = new Map();
  const table = (t) => tables.get(t) || tables.set(t, { name: t, columns: [], pk: [], fks: [] }).get(t);
  if (isPg) {
    for (const c of await conn.query(
      `SELECT c.table_name AS t, c.column_name AS name, c.data_type AS type, c.is_nullable AS nullable,
              c.column_default AS dflt, c.is_generated AS generated, c.is_identity AS identity
         FROM information_schema.columns c
         JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND tb.table_type = 'BASE TABLE'
        ORDER BY c.table_name, c.ordinal_position`)) {
      table(c.t).columns.push({
        name: c.name, type: String(c.type), notNull: c.nullable === 'NO', dflt: c.dflt,
        generated: c.generated === 'ALWAYS', identity: c.identity === 'YES',
      });
    }
    for (const k of await conn.query(
      `SELECT cl.relname AS t, a.attname AS name
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = cl.relnamespace
         CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, n)
         JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = k.attnum
        WHERE con.contype = 'p' AND ns.nspname = current_schema()
        ORDER BY cl.relname, k.n`)) {
      if (tables.has(k.t)) table(k.t).pk.push(k.name);
    }
    for (const f of await conn.query(
      `SELECT cl.relname AS t, a.attname AS col, pcl.relname AS parent
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = cl.relnamespace
         JOIN pg_class pcl ON pcl.oid = con.confrelid
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND ns.nspname = current_schema() AND cardinality(con.conkey) = 1`)) {
      if (tables.has(f.t)) table(f.t).fks.push({ col: f.col, parent: f.parent });
    }
    return tables;
  }
  for (const { name } of await conn.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
    const t = table(name);
    const info = await conn.query(`PRAGMA table_xinfo(${q(name)})`);
    for (const c of info) {
      if (c.hidden === 1) continue;
      t.columns.push({
        name: c.name, type: String(c.type || ''), notNull: !!c.notnull, dflt: c.dflt_value,
        generated: c.hidden === 2 || c.hidden === 3, identity: false,
      });
    }
    t.pk = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    for (const f of await conn.query(`PRAGMA foreign_key_list(${q(name)})`)) t.fks.push({ col: f.from, parent: f.table });
  }
  return tables;
}

// The facility's own tables on Postgres: those its migration files create
// (should HQ's ever share the schema, they stay out of a facility export).
let _facilityTables = null;
function facilityTables() {
  if (_facilityTables) return _facilityTables;
  const dir = path.join(__dirname, '..', '..', 'migrations', 'pg');
  const set = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!/^\d+_.*\.sql$/.test(f) || /central/.test(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([a-z_][a-z0-9_]*)"?/gi)) set.add(m[1].toLowerCase());
  }
  return (_facilityTables = set);
}

// Parents first, then alphabetical: the same order for the same tables on
// either database.
function loadOrder(names) {
  const set = new Set(names);
  const parents = new Map(names.map((n) => [n, new Set()]));
  for (const [key, parent] of Object.entries(C.FK_EDGES)) {
    const child = key.split('.')[0];
    if (child !== parent && set.has(child) && set.has(parent)) parents.get(child).add(parent);
  }
  const out = [], done = new Set();
  while (out.length < names.length) {
    const ready = names.filter((n) => !done.has(n) && [...parents.get(n)].every((p) => done.has(p))).sort();
    if (!ready.length) throw new ArchiveError(`These tables point at each other in a circle: ${names.filter((n) => !done.has(n)).join(', ')}`);
    for (const n of ready) { out.push(n); done.add(n); }
  }
  return out;
}

// How a column's values are read: SQLite by its type's affinity
// (sqlite.org/datatype3.html 3.1), Postgres by its type.
function typeKind(type, isPg) {
  const t = String(type || '').toLowerCase();
  if (isPg) {
    if (/^(integer|smallint|bigint)$/.test(t)) return 'int';
    if (/^(double precision|real|numeric)$/.test(t)) return 'num';
    if (t === 'boolean') return 'bool';
    return 'text';
  }
  if (t.includes('int')) return 'int';
  if (/char|clob|text/.test(t)) return 'text';
  if (!t || t.includes('blob')) return 'blob';
  return 'num';
}

function numberToArchive(v, kind) {
  if (v === null || v === undefined) return { value: null };
  if (typeof v === 'number') return { value: v };
  if (typeof v === 'bigint') return { value: Number(v) };
  if (typeof v === 'boolean') return { value: v ? 1 : 0 };
  const s = String(v).trim();
  if (!s) return { value: null };
  if (kind === 'int' ? /^-?\d+$/.test(s) : /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return { value: Number(s) };
  return { problem: `isn't a number (${s.slice(0, 40)})` };
}

const isDatetimeNow = (dflt) => /datetime\s*\(\s*'now'\s*\)/i.test(String(dflt || ''));

// value as stored -> { value } for the archive, or { problem }.
function exportConverter(table, col, isPg, zone) {
  const instant = (C.INSTANTS[table] || {})[col.name];
  if (instant) {
    const defaultUtc = !isPg && isDatetimeNow(col.dflt);
    return (v) => C.instantToArchive(v, instant, zone, defaultUtc);
  }
  if ((C.DATES[table] || []).includes(col.name)) return (v) => C.dateToArchive(v);
  const kind = typeKind(col.type, isPg);
  if (kind === 'int' || kind === 'num') return (v) => numberToArchive(v, kind);
  return (v) => ({ value: Buffer.isBuffer(v) ? { $b64: v.toString('base64') } : v === undefined ? null : v });
}

// A settings row as it travels, or null when it stays behind.
function exportSetting(row, includeHq) {
  if (C.MACHINE_SETTINGS.includes(row.key) || C.HQ_STATUS_SETTINGS.includes(row.key)) return null;
  if (!includeHq && C.HQ_SETTINGS.includes(row.key)) return null;
  if (row.key === 'setup' && row.value) {
    // The one-time setup code opens only the install it was printed for.
    try {
      const st = JSON.parse(row.value);
      if (st && typeof st === 'object') {
        for (const f of SETUP_CODE_FIELDS) delete st[f];
        return { ...row, value: JSON.stringify(st) };
      }
    } catch (e) { /* not ours to rewrite */ }
  }
  return row;
}

function checksumOf(entries) {
  const h = crypto.createHash('sha256');
  for (const name of Object.keys(entries).sort()) h.update(`${name} ${entries[name].sha256} ${entries[name].bytes}\n`);
  return h.digest('hex');
}

function parseSetting(v) {
  if (v === null || v === undefined) return v;
  try { return JSON.parse(v); } catch (e) { return v; }
}

function tableNames(schema, isPg) {
  return [...schema.keys()].filter((n) => !C.EXCLUDED_TABLES.includes(n) && (!isPg || facilityTables().has(n)));
}

// ── Export ──────────────────────────────────────────────────────────────────
/**
 * Write an export to `file` (created; an existing file is refused).
 *   conn       the connection module, or anything with transaction/query/run
 *   isPg       which database that is
 *   storage    the file storage port (photos come from it)
 *   zone       the facility's time zone (how SQLite's local times are read)
 * Resolves { file, bytes, counts, rows, photos, problems }.
 */
async function exportArchive({ conn, isPg, file, passphrase, storage, zone, profile = '', includeHq = false, log = () => {} }) {
  const writer = await createWriter(file, { passphrase });
  const entries = {}, counts = {}, problems = [];
  let problemCount = 0, header = null;
  const photoRefs = new Set();
  const note = (p) => { problemCount++; if (problems.length < 1000) problems.push(p); };
  try {
    await conn.transaction(async (tx) => {
      // One snapshot: rows written while the export runs are either all in it or not at all.
      if (isPg) await tx.run('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const schema = await describe(tx, isPg);
      const order = loadOrder(tableNames(schema, isPg));
      let facility = '';
      if (schema.has('settings')) {
        const r = await tx.query1("SELECT value FROM settings WHERE key='facility_name'");
        if (r) facility = String(parseSetting(r.value));
      }
      header = {
        app: APP, appVersion: APP_VERSION, format: FORMAT, createdAt: new Date().toISOString(),
        source: { driver: isPg ? 'pg' : 'sqlite', profile, timeZone: zone, facility, host: os.hostname() },
        includesHq: !!includeHq,
        tables: order.map((t) => ({ name: t, columns: schema.get(t).columns.filter((c) => !c.generated).map((c) => c.name) })),
      };
      const he = writer.entry('header.json');
      await he.write(JSON.stringify(header));
      entries['header.json'] = await he.end();

      for (const t of header.tables) {
        const desc = schema.get(t.name);
        const colsOf = new Map(desc.columns.map((c) => [c.name, c]));
        const conv = t.columns.map((n) => exportConverter(t.name, colsOf.get(n), isPg, zone));
        const photoIdx = (C.PHOTO_COLUMNS[t.name] || []).map((n) => t.columns.indexOf(n)).filter((i) => i >= 0);
        const pk = desc.pk.filter((p) => t.columns.includes(p));
        const idOf = (row) => (pk.length ? pk.map((p) => row[p]).join('/') : '');
        const entry = writer.entry(`tables/${t.name}.jsonl`);
        let n = 0;
        const select = `SELECT ${t.columns.map(q).join(', ')} FROM ${q(t.name)}`;
        const writePage = async (rows) => {
          let out = '';
          for (let row of rows) {
            if (t.name === 'settings' && !(row = exportSetting(row, includeHq))) continue;
            const vals = t.columns.map((c, i) => {
              const r = conv[i](row[c]);
              if (r.problem) { note({ table: t.name, id: idOf(row), column: c, says: r.problem }); return null; }
              return r.value;
            });
            for (const i of photoIdx) if (typeof vals[i] === 'string' && vals[i].startsWith('photos/')) photoRefs.add(vals[i]);
            out += JSON.stringify(vals) + '\n';
            n++;
          }
          if (out) await entry.write(out);
        };
        if (pk.length && pk.length === desc.pk.length) {
          // Keyset pages: steady however large the table is.
          const keys = pk.map(q).join(', ');
          let last = null;
          for (;;) {
            const where = last ? ` WHERE (${keys}) > (${pk.map(() => '?').join(', ')})` : '';
            const rows = await tx.query(`${select}${where} ORDER BY ${keys} LIMIT ${PAGE}`, last || []);
            await writePage(rows);
            if (rows.length < PAGE) break;
            last = pk.map((p) => rows[rows.length - 1][p]);
          }
        } else {
          await writePage(await tx.query(select));
        }
        entries[`tables/${t.name}.jsonl`] = await entry.end();
        counts[t.name] = n;
        log(`  ${t.name.padEnd(24)} ${n}`);
      }
    });

    // Photos: every file under photos/, and a note of any a row names that isn't there.
    const keys = (await storage.list('photos/')).filter((k) => NAME_RE.test(k) && !path.posix.basename(k).startsWith('.'));
    let photoBytes = 0, photoCount = 0;
    const missing = [];
    for (const key of keys) {
      const bytes = await storage.get(key);
      if (!bytes) continue;
      const e = writer.entry(key);
      await e.write(Buffer.from(bytes));
      entries[key] = await e.end();
      photoCount++; photoBytes += bytes.length;
    }
    const have = new Set(keys);
    for (const ref of photoRefs) if (!have.has(ref)) missing.push(ref);
    log(`  ${'photos'.padEnd(24)} ${photoCount}${missing.length ? ` (${missing.length} named by a record but not in storage)` : ''}`);

    const manifest = {
      app: APP, appVersion: APP_VERSION, counts, entries, checksum: checksumOf(entries),
      photos: { count: photoCount, bytes: photoBytes, missing },
      problems: { count: problemCount, items: problems },
    };
    const me = writer.entry('manifest.json');
    await me.write(JSON.stringify(manifest));
    await me.end();
    await writer.finish();
    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    return { file, bytes: fs.statSync(file).size, header, counts, rows, photos: manifest.photos, problems: manifest.problems, checksum: manifest.checksum };
  } catch (e) {
    await writer.abort();
    throw e;
  }
}

// ── Import ──────────────────────────────────────────────────────────────────
// Blocks -> entries, in order; an entry's chunks are read before the next starts.
function entryReader(blocks) {
  const it = blocks[Symbol.asyncIterator]();
  async function nextBlock() { const r = await it.next(); return r.done ? null : r.value; }
  const hashes = {};
  return {
    hashes,
    // Stop reading early (only the header was wanted, or something failed).
    async close() { try { await it.return(); } catch (e) { /* already finished */ } },
    async next() {
      const first = await nextBlock();
      if (!first) return null;
      const name = first.name;
      return {
        name,
        // Feeds each chunk to `onChunk`; records the entry's sha256 + size.
        async read(onChunk) {
          const h = crypto.createHash('sha256');
          let bytes = 0, b = first;
          for (;;) {
            if (b.name !== name) throw new ArchiveError('The export file is damaged (an entry is cut off).');
            h.update(b.data); bytes += b.data.length;
            if (onChunk) await onChunk(b.data);
            if (b.last) break;
            b = await nextBlock();
            if (!b) throw new ArchiveError('The export file is damaged (an entry is cut off).');
          }
          hashes[name] = { sha256: h.digest('hex'), bytes };
        },
        async buffer() {
          const parts = [];
          await this.read((c) => { parts.push(c); });
          return Buffer.concat(parts);
        },
      };
    },
  };
}

// archive value -> what the target stores in that column.
function importConverter(table, col, isPg, zone) {
  // SQLite keeps "no value" in these columns as '' (their default): so does an import.
  const emptyText = !isPg && /^''$/.test(String(col.dflt || '').trim());
  const instant = (C.INSTANTS[table] || {})[col.name];
  if (instant) {
    return (v) => {
      const out = C.instantFromArchive(v, instant, zone, isPg ? 'pg' : 'sqlite');
      return out === null && emptyText ? '' : out;
    };
  }
  if ((C.DATES[table] || []).includes(col.name)) {
    return (v) => (v === null || v === undefined || v === '' ? (emptyText ? '' : null) : v);
  }
  const kind = typeKind(col.type, isPg);
  return (v) => {
    if (v === undefined) return null;
    if (v && typeof v === 'object' && typeof v.$b64 === 'string') return Buffer.from(v.$b64, 'base64');
    if (v === null) return null;
    if (isPg && kind === 'int') {
      if (typeof v === 'boolean') return v ? 1 : 0;
      const n = typeof v === 'number' ? v : /^-?\d+$/.test(String(v).trim()) ? Number(v) : NaN;
      if (!Number.isInteger(n)) throw new ArchiveError(`${table}.${col.name} holds ${JSON.stringify(v).slice(0, 40)}, which isn't a whole number.`);
      return n;
    }
    if (isPg && kind === 'num') {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) throw new ArchiveError(`${table}.${col.name} holds ${JSON.stringify(v).slice(0, 40)}, which isn't a number.`);
      return n;
    }
    if (isPg && kind === 'bool') return v === true || v === 1 || v === '1' || v === 'true';
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  };
}

async function countRows(conn, table) {
  const r = await conn.query1(`SELECT COUNT(*) AS n FROM ${q(table)}`);
  return Number(r && r.n) || 0;
}

/**
 * Read only the header of an export (no passphrase check beyond the first
 * frame): what it is, before anything is changed.
 */
async function readHeader(file, passphrase) {
  const reader = await openReader(file, { passphrase });
  const entries = entryReader(reader.blocks());
  try {
    const e = await entries.next();
    if (!e || e.name !== 'header.json') throw new ArchiveError('The export file is damaged (no header).');
    try { return JSON.parse(String(await e.buffer())); } catch (err) { throw new ArchiveError('The export file is damaged (its header).'); }
  } finally {
    await entries.close();
    await reader.close();
  }
}

/**
 * The install must be new: no accounts, no records, and no OpsPoint server
 * running on it. Throws ArchiveError saying what is there.
 */
async function assertFresh(conn, isPg, target) {
  const busy = [];
  for (const t of target.keys()) {
    if (SEEDED.includes(t) || C.EXCLUDED_TABLES.includes(t)) continue;
    if (isPg && !facilityTables().has(t)) continue;
    const n = await countRows(conn, t);
    if (n) busy.push(`${t}: ${n}`);
  }
  if (busy.length) {
    throw new ArchiveError(`This install already has records (${busy.slice(0, 5).join(', ')}${busy.length > 5 ? ', and more' : ''}). ` +
      'Import only into a new, empty install.');
  }
  if (target.has('app_instances')) {
    const live = (await require('../health/instances').list(conn)).filter((i) => i.live && !i.self);
    if (live.length) {
      throw new ArchiveError(`OpsPoint is running on this database (${live[0].hostname}, process ${live[0].pid}): stop it, then import.`);
    }
  }
}

/**
 * Load an export into this install, which must be new (assertFresh).
 *   conn, isPg, storage, zone   as for exportArchive (the TARGET's)
 *   contentType(bytes, key)     the photo type sniffer (server/storage/photos.js)
 *   keepHq                      keep the export's link to HQ, if it has one
 *                               (only when this install replaces the old one)
 *   syncTables                  db.SYNC_TABLES: with keepHq, everything is
 *                               queued for HQ again
 * Resolves { header, counts, rows, photos, problems, ownAudit, queuedForHq }.
 */
async function importArchive({ conn, isPg, file, passphrase, storage, zone, contentType, keepHq = false, syncTables = [], log = () => {} }) {
  const reader = await openReader(file, { passphrase });
  const entries = entryReader(reader.blocks());
  const uploaded = [];
  let existed = null;
  try {
    const he = await entries.next();
    if (!he || he.name !== 'header.json') throw new ArchiveError('The export file is damaged (no header).');
    let header;
    try { header = JSON.parse(String(await he.buffer())); } catch (e) { throw new ArchiveError('The export file is damaged (its header).'); }
    if (header.app !== APP) throw new ArchiveError("This isn't an export of an OpsPoint facility.");
    if (compareVersions(header.appVersion, APP_VERSION) > 0) {
      throw new ArchiveError(`This export came from OpsPoint ${header.appVersion}, newer than this install (${APP_VERSION}): update this install first.`);
    }
    if (!Array.isArray(header.tables)) throw new ArchiveError('The export file is damaged (its header).');

    const target = await describe(conn, isPg);
    for (const t of header.tables) {
      const tt = target.get(t.name);
      if (!tt) throw new ArchiveError(`The export has a table this install doesn't (${t.name}): update this install first.`);
      const have = new Set(tt.columns.map((c) => c.name));
      const extra = t.columns.filter((c) => !have.has(c));
      if (extra.length) throw new ArchiveError(`The export has columns this install doesn't (${t.name}: ${extra.join(', ')}): update this install first.`);
    }
    await assertFresh(conn, isPg, target);
    existed = new Set(await storage.list('photos/'));

    const archived = new Set(header.tables.map((t) => t.name));
    const parents = new Set();
    for (const tt of target.values()) for (const fk of tt.fks) parents.add(fk.parent);
    const counts = {}, loaded = {}, problems = [], done = new Set();
    let problemCount = 0, ownAudit = [], manifest = null, queuedForHq = 0, settingKeys = [];
    const photoTotals = { count: 0, bytes: 0 };
    const byKind = {};
    const note = (p) => { problemCount++; byKind[p.kind] = (byKind[p.kind] || 0) + 1; if (problems.length < 1000) problems.push(p); };

    await conn.transaction(async (tx) => {
      // A new install's own start wrote a few audit lines: they stay, after the export's.
      if (archived.has('audit_log')) {
        ownAudit = await tx.query('SELECT * FROM audit_log ORDER BY id');
        if (ownAudit.length) await tx.run('DELETE FROM audit_log');
      }
      // The four groups a new install seeds: the export brings its own (same or edited).
      if (archived.has('groups')) await tx.run('DELETE FROM groups');

      for (const t of header.tables) {
        const entry = await entries.next();
        if (!entry || entry.name !== `tables/${t.name}.jsonl`) throw new ArchiveError('The export file is damaged (tables out of order).');
        const tt = target.get(t.name);
        const tcol = new Map(tt.columns.map((c) => [c.name, c]));
        const keep = [];
        t.columns.forEach((n, i) => { if (!tcol.get(n).generated) keep.push(i); });
        const names = keep.map((i) => t.columns[i]);
        const conv = names.map((n) => importConverter(t.name, tcol.get(n), isPg, zone));
        const pkIdx = tt.pk.length === 1 ? names.indexOf(tt.pk[0]) : -1;
        const fks = tt.fks.filter((fk) => names.includes(fk.col) && fk.parent !== t.name)
          .map((fk) => ({ ...fk, idx: names.indexOf(fk.col), nullable: !tcol.get(fk.col).notNull }));
        for (const fk of fks) {
          // A parent the export carries must already be in (columns.js FK_EDGES sets the order).
          if (archived.has(fk.parent) && !done.has(fk.parent)) {
            throw new ArchiveError(`The export loads ${t.name} before ${fk.parent}, which it points at: this install can't take it in that order.`);
          }
        }
        const track = parents.has(t.name) && pkIdx >= 0 ? (loaded[t.name] = new Set()) : null;
        const identity = isPg && tt.columns.some((c) => c.identity && names.includes(c.name));
        const isSettings = t.name === 'settings';
        const keyIdx = isSettings ? names.indexOf('key') : -1;
        const head = `INSERT INTO ${q(t.name)} (${names.map(q).join(', ')}) ${identity ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES `;
        // A column this install requires that the export left empty (SQLite
        // allowed it; Postgres doesn't) gets the column's own default — on
        // Postgres the DEFAULT keyword, on SQLite its value — and a note.
        const defaults = new Map();
        for (const [k, nm] of names.entries()) {
          const c = tcol.get(nm);
          if (!c.notNull || c.dflt === null || c.dflt === undefined || k === pkIdx) continue;
          if (isPg) defaults.set(k, DEFAULT);
          else {
            const r = await tx.query1(`SELECT ${c.dflt} AS v`);       // the schema's own expression
            defaults.set(k, r ? r.v : null);
          }
        }
        let batch = [], n = 0;
        const insert = (rows) => {
          const params = [];
          const tuples = rows.map((row) => `(${row.map((v) => { if (v === DEFAULT) return 'DEFAULT'; params.push(v); return '?'; }).join(', ')})`);
          let sql = head + tuples.join(', ');
          if (isSettings) sql += ' ON CONFLICT (key) DO UPDATE SET value = excluded.value';
          return tx.run(sql, params);
        };
        // One statement per batch, inside a savepoint: when the database
        // refuses one, the batch goes again row by row to name the record (and
        // the database's reason, never the values).
        const flush = async () => {
          if (!batch.length) return;
          await tx.run('SAVEPOINT archive_batch', []);
          try {
            await insert(batch);
            await tx.run('RELEASE SAVEPOINT archive_batch', []);
          } catch (e) {
            await tx.run('ROLLBACK TO SAVEPOINT archive_batch', []);
            for (const row of batch) {
              try { await insert([row]); } catch (e2) {
                // "invalid input syntax for type integer: "<the value>"" — the value stays out.
                const why = String(e2.message).split('\n')[0].replace(/^(invalid input[^:]*):.*$/i, '$1');
                throw new ArchiveError(`${t.name} ${pkIdx >= 0 ? row[pkIdx] : ''}: this install's database refused it (${why}).`);
              }
            }
            throw e;
          }
          batch = [];
        };
        const onLine = async (line) => {
          if (!line) return;
          let row;
          try { row = JSON.parse(line); } catch (e) { throw new ArchiveError(`The export file is damaged (${t.name}).`); }
          if (!Array.isArray(row) || row.length !== t.columns.length) throw new ArchiveError(`The export file is damaged (${t.name}).`);
          const vals = keep.map((i, k) => conv[k](row[i]));
          for (const fk of fks) {
            const v = vals[fk.idx];
            if (v === null || v === undefined || v === '') continue;
            if (done.has(fk.parent) && !loaded[fk.parent]) continue;      // a parent keyed on two columns: not checked
            const have = loaded[fk.parent];
            if (have && have.has(v)) continue;
            const id = pkIdx >= 0 ? vals[pkIdx] : '';
            if (!fk.nullable) throw new ArchiveError(`${t.name} ${id}: its ${fk.col} points at ${fk.parent} ${v}, which the export doesn't have.`);
            note({ kind: 'dangling', table: t.name, id, column: fk.col, says: `pointed at ${fk.parent} ${v}, which no longer exists: left empty` });
            vals[fk.idx] = null;
          }
          for (const [k, d] of defaults) {
            if (vals[k] !== null && vals[k] !== undefined) continue;
            vals[k] = d;
            note({ kind: 'default', table: t.name, id: pkIdx >= 0 ? vals[pkIdx] : '', column: names[k], says: "was empty, which this install's database doesn't allow: given the column's default" });
          }
          if (track) track.add(vals[pkIdx]);
          if (isSettings) settingKeys.push(vals[keyIdx]);
          batch.push(vals); n++;
          if (batch.length >= BATCH) await flush();
        };
        const decoder = new StringDecoder('utf8');
        let rest = '';
        await entry.read(async (chunk) => {
          const lines = (rest + decoder.write(chunk)).split('\n');
          rest = lines.pop();
          for (const line of lines) await onLine(line);
        });
        rest += decoder.end();
        if (rest) await onLine(rest);
        await flush();
        counts[t.name] = n;
        done.add(t.name);
        log(`  ${t.name.padEnd(24)} ${n}`);

        if (t.name === 'audit_log' && ownAudit.length) {
          const cols = Object.keys(ownAudit[0]).filter((c) => c !== 'id' && tcol.has(c) && !tcol.get(c).generated);
          for (const r of ownAudit) {
            await tx.run(`INSERT INTO audit_log (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => r[c]));
          }
        }
      }

      // Rows written with their own ids: Postgres's counters move past them.
      if (isPg) {
        for (const t of header.tables) {
          for (const c of target.get(t.name).columns) {
            if (!c.identity) continue;
            const tq = q(t.name), cq = q(c.name);        // checked names, safe inside the quotes below
            await tx.run(`SELECT setval(pg_get_serial_sequence('${t.name}', '${c.name}'),
                                 COALESCE((SELECT MAX(${cq}) FROM ${tq}), 0) + 1, false)`, []);
          }
        }
      }

      // The inserts queued every row for HQ. A copy starts with nothing queued;
      // a replacement that keeps the HQ link sends HQ everything again (HQ
      // takes each row once, by its id).
      if (target.has('sync_outbox')) {
        await tx.run('DELETE FROM sync_outbox');
        const url = settingKeys.includes('central_url') ? await tx.query1("SELECT value FROM settings WHERE key='central_url'") : null;
        if (keepHq && url && parseSetting(url.value)) {
          for (const t of syncTables) {
            if (!target.has(t)) continue;
            // WITH first: the pg driver adds RETURNING id only to a statement that starts with INSERT.
            const r = await tx.run(`WITH src AS (SELECT id FROM ${q(t)})
              INSERT INTO sync_outbox (table_name, row_id, op) SELECT '${t}', id, 'upsert' FROM src`, []);
            queuedForHq += Number(r && r.changes) || 0;
          }
        }
      }

      // Photos, into this install's file storage.
      for (;;) {
        const entry = await entries.next();
        if (!entry) throw new ArchiveError('The export file is incomplete: it has no manifest.');
        if (entry.name === 'manifest.json') {
          try { manifest = JSON.parse(String(await entry.buffer())); } catch (e) { throw new ArchiveError('The export file is damaged (its manifest).'); }
          break;
        }
        if (!/^photos\//.test(entry.name)) throw new ArchiveError('The export file is damaged (an entry out of place).');
        const bytes = await entry.buffer();
        await storage.put(entry.name, bytes, { contentType: contentType(bytes, entry.name) });
        if (!existed.has(entry.name)) uploaded.push(entry.name);
        photoTotals.count++; photoTotals.bytes += bytes.length;
      }
      if (await entries.next()) throw new ArchiveError('The export file is damaged (something after its manifest).');

      // The manifest the export wrote last must describe exactly what arrived.
      const got = { ...entries.hashes };
      delete got['manifest.json'];
      const want = (manifest && manifest.entries) || {};
      const bad = [...new Set([...Object.keys(got), ...Object.keys(want)])]
        .filter((k) => !got[k] || !want[k] || got[k].sha256 !== want[k].sha256 || got[k].bytes !== want[k].bytes);
      if (bad.length || checksumOf(got) !== manifest.checksum) {
        throw new ArchiveError(`The export doesn't match its own manifest (${bad.slice(0, 3).join(', ') || 'checksum'}): it is damaged.`);
      }
      for (const t of header.tables) {
        if (manifest.counts[t.name] !== counts[t.name]) throw new ArchiveError(`${t.name}: the export lists ${manifest.counts[t.name]} rows but holds ${counts[t.name]}.`);
      }
      await verifyCounts(tx, header, counts, settingKeys, ownAudit.length);
    });

    // And once more, as anyone will see it now.
    await verifyCounts(conn, header, counts, settingKeys, ownAudit.length);
    const stored = new Set(await storage.list('photos/'));
    const lost = Object.keys(entries.hashes).filter((k) => /^photos\//.test(k) && !stored.has(k));
    if (lost.length) throw new ArchiveError(`${lost.length} photo(s) are not in this install's file storage after the import (${lost[0]}).`);

    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      header, counts, rows, photos: photoTotals, problems: { count: problemCount, byKind, items: problems },
      exportProblems: manifest.problems || { count: 0, items: [] }, missingPhotos: (manifest.photos && manifest.photos.missing) || [],
      ownAudit: ownAudit.length, queuedForHq,
    };
  } catch (e) {
    // Nothing of the import stays: the transaction rolled back; photos it added go too.
    for (const key of uploaded) await storage.remove(key).catch(() => {});
    throw e;
  } finally {
    await entries.close();
    await reader.close();
  }
}

// Every table holds what the export said it would (settings: every key the
// export carried is there; audit_log: the export's lines and the install's own).
async function verifyCounts(conn, header, counts, settingKeys, ownAudit) {
  for (const t of header.tables) {
    if (t.name === 'settings') {
      const have = new Set((await conn.query('SELECT key FROM settings')).map((r) => r.key));
      const missing = settingKeys.filter((k) => !have.has(k));
      if (missing.length) throw new ArchiveError(`After the import, settings are missing: ${missing.slice(0, 5).join(', ')}.`);
      continue;
    }
    const want = counts[t.name] + (t.name === 'audit_log' ? ownAudit : 0);
    const n = await countRows(conn, t.name);
    if (n !== want) throw new ArchiveError(`After the import, ${t.name} holds ${n} rows instead of ${want}.`);
  }
}

module.exports = {
  exportArchive, importArchive, readHeader, describe, loadOrder, facilityTables, compareVersions,
  ArchiveError, APP, APP_VERSION,
};
