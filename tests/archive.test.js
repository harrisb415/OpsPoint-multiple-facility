// Export and import (roadmap phase 7): the encrypted archive file, the
// registry of what travels and how its times cross between SQLite and
// Postgres, and the round trip — this install (whichever driver the suite
// runs on) -> a new SQLite install -> on Postgres runs also a new Postgres
// schema — each exported again and compared table by table. Plus what import
// refuses, the HQ link, and the restore drill. Every database here is a
// throwaway: this file's own, temporary folders, a scratch schema.
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_archive_'));
process.env.OPSPOINT_DATA = path.join(TMP, 'a');
process.env.OPSPOINT_DB = path.join(TMP, 'a', 'a.db');
process.env.OPSPOINT_UPDATES = 'platform';
fs.mkdirSync(process.env.OPSPOINT_DATA, { recursive: true });

const { ready } = require('../server');
const conn = require('../server/db/connection');
const settings = require('../server/settings');
const archive = require('../server/archive');
const format = require('../server/archive/format');
const C = require('../server/archive/columns');
const { storage } = require('../server/storage');
const { BY_NAME } = require('../server/settings/schema');
const { seedEverything, GONE } = require('./fixtures/archiveSeed');

jest.setTimeout(180000);

const PASS = 'correct horse battery staple';
const ZONE = settings.timeZone().name;
const CLI = path.join(__dirname, '..', 'server', 'cli', 'opspoint.js');
const ROOT = path.join(__dirname, '..');

// A new install in its own folder: none of this process's settings.
function installEnv(dir, extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!BY_NAME[k] && !BY_NAME[k.replace(/_FILE$/, '')]) env[k] = v;
  return {
    ...env, OPSPOINT_CONFIG: 'none', OPSPOINT_DB_DRIVER: 'sqlite', OPSPOINT_DATA: dir, OPSPOINT_DB: path.join(dir, 'x.db'),
    OPSPOINT_STORAGE: 'local', OPSPOINT_STORAGE_DIR: dir, OPSPOINT_UPDATES: 'platform', TZ: ZONE, ...extra,
  };
}
const cli = (args, env, input = `${PASS}\n`) =>
  spawnSync(process.execPath, [CLI, ...args], { env, input, encoding: 'utf8', timeout: 170000, maxBuffer: 64 << 20 });
const lastJson = (out) => JSON.parse(String(out).trim().split('\n').pop());

// Every entry of an archive: name -> Buffer.
async function contents(file, passphrase = PASS) {
  const r = await format.openReader(file, { passphrase });
  const out = {};
  try {
    for await (const b of r.blocks()) out[b.name] = out[b.name] ? Buffer.concat([out[b.name], b.data]) : b.data;
  } finally { await r.close(); }
  return out;
}
const linesOf = (buf) => String(buf || '').split('\n').filter(Boolean);
const rowsOf = (all, t) => linesOf(all[`tables/${t}.jsonl`]).map((l) => JSON.parse(l));
const settingsOf = (all) => Object.fromEntries(rowsOf(all, 'settings').map(([k, v]) => [k, v]));

// The Postgres schema as the migration files declare it: table -> column -> type.
function pgColumns() {
  const out = {};
  const dir = path.join(ROOT, 'migrations', 'pg');
  for (const f of fs.readdirSync(dir).filter((x) => /^\d+_.*\.sql$/.test(x) && !/central/.test(x)).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
      const t = m[1].toLowerCase(); out[t] = out[t] || {};
      for (const line of m[2].split('\n')) {
        const c = /^\s*([a-z_][a-z0-9_]*)\s+([a-z]+)/i.exec(line);
        if (!c || /^(primary|unique|constraint|check|foreign)$/i.test(c[1])) continue;
        out[t][c[1].toLowerCase()] = c[2].toLowerCase();
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+([a-z_]+)\s+ADD COLUMN(?: IF NOT EXISTS)?\s+([a-z_]+)\s+([a-z]+)/gi)) {
      const t = m[1].toLowerCase(); out[t] = out[t] || {};
      out[t][m[2].toLowerCase()] = m[3].toLowerCase();
    }
  }
  return out;
}
function pgForeignKeys() {
  const out = {};
  const dir = path.join(ROOT, 'migrations', 'pg');
  for (const f of fs.readdirSync(dir).filter((x) => /^\d+_.*\.sql$/.test(x) && !/central/.test(x))) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)\s*\(([\s\S]*?)\n\);/gi)) {
      for (const r of m[2].matchAll(/^\s*([a-z_]+)\s+[a-z ]+?REFERENCES\s+([a-z_]+)/gim)) out[`${m[1]}.${r[1]}`] = r[2];
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+([a-z_]+)\s+ADD COLUMN(?: IF NOT EXISTS)?\s+([a-z_]+)[^;]*?REFERENCES\s+([a-z_]+)/gi)) out[`${m[1]}.${m[2]}`] = m[3];
  }
  return out;
}

afterAll(async () => {
  await conn.close().catch(() => {});       // Windows won't remove an open database file
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* the OS cleans its temp folder */ }
});

// ── The file ────────────────────────────────────────────────────────────────
describe('the archive file', () => {
  async function write(file, entries, passphrase = PASS) {
    const w = await format.createWriter(file, { passphrase });
    for (const [name, data] of entries) { const e = w.entry(name); if (data.length) await e.write(data); await e.end(); }
    await w.finish();
  }
  const sample = () => [
    ['header.json', Buffer.from('{"a":1}')],
    ['tables/big.jsonl', crypto.randomBytes(3 * 1024 * 1024 + 17)],      // several blocks, many frames
    ['tables/empty.jsonl', Buffer.alloc(0)],
    ['photos/p.jpg', crypto.randomBytes(1000)],
    ['manifest.json', Buffer.from('{}')],
  ];

  test('gives back exactly what went in, entry by entry, and starts with no plain text but its header', async () => {
    const f = path.join(TMP, 'f1.opspoint');
    const entries = sample();
    await write(f, entries);
    const got = await contents(f);
    for (const [name, data] of entries) expect(Buffer.compare(got[name] || Buffer.alloc(0), data)).toBe(0);
    const raw = fs.readFileSync(f);
    expect(raw.subarray(0, 17).toString()).toBe('OPSPOINT-ARCHIVE\n');
    expect(raw.includes(Buffer.from('tables/big.jsonl'))).toBe(false);
    if (process.platform !== 'win32') expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    await expect(write(f, entries)).rejects.toThrow(/EEXIST/);             // never overwritten
  });

  test('refuses a wrong passphrase, a short one, and names it can not carry', async () => {
    const f = path.join(TMP, 'f2.opspoint');
    await write(f, sample());
    await expect(contents(f, 'not the passphrase')).rejects.toThrow(/passphrase doesn't open/);
    await expect(format.createWriter(path.join(TMP, 'f2b'), { passphrase: 'short' })).rejects.toThrow(/at least 12/);
    const w = await format.createWriter(path.join(TMP, 'f2c'), { passphrase: PASS });
    expect(() => w.entry('../etc/passwd')).toThrow(/Not an archive entry name/);
    expect(() => w.entry('photos/a/b.jpg')).toThrow(/Not an archive entry name/);
    await w.abort();
    expect(fs.existsSync(path.join(TMP, 'f2c'))).toBe(false);
  });

  test('a changed byte, a cut-off end or extra bytes all fail before anything is trusted', async () => {
    const f = path.join(TMP, 'f3.opspoint');
    await write(f, sample());
    const raw = fs.readFileSync(f);
    const flipped = Buffer.from(raw); flipped[Math.floor(raw.length / 2)] ^= 1;
    fs.writeFileSync(`${f}.flip`, flipped);
    await expect(contents(`${f}.flip`)).rejects.toThrow(/damaged/);
    fs.writeFileSync(`${f}.cut`, raw.subarray(0, raw.length - 100));
    await expect(contents(`${f}.cut`)).rejects.toThrow(/cut short|damaged/);
    fs.writeFileSync(`${f}.more`, Buffer.concat([raw, Buffer.from('more')]));
    await expect(contents(`${f}.more`)).rejects.toThrow(/damaged|cut short/);

  });

  test('an archive in a newer format asks for an update first', async () => {
    const f = path.join(TMP, 'f4.opspoint');
    await write(f, sample());
    const raw = fs.readFileSync(f);
    const hlen = raw.readUInt32BE(17);
    const header = JSON.parse(raw.subarray(21, 21 + hlen).toString());
    const newer = Buffer.from(JSON.stringify({ ...header, format: 2 }));
    const len = Buffer.alloc(4); len.writeUInt32BE(newer.length);
    fs.writeFileSync(`${f}.new`, Buffer.concat([raw.subarray(0, 17), len, newer, raw.subarray(21 + hlen)]));
    await expect(contents(`${f}.new`)).rejects.toThrow(/newer OpsPoint/);
  });
});

// ── What travels, and how its times cross ──────────────────────────────────
describe('the registry', () => {
  test('lists every time and date column of the Postgres schema, and nothing else', () => {
    const pg = pgColumns();
    const instants = [], dates = [];
    for (const [t, cols] of Object.entries(pg)) {
      if (C.EXCLUDED_TABLES.includes(t)) continue;
      for (const [c, ty] of Object.entries(cols)) {
        if (/^timestamp/.test(ty)) instants.push(`${t}.${c}`);
        if (ty === 'date') dates.push(`${t}.${c}`);
      }
    }
    const regI = Object.entries(C.INSTANTS).flatMap(([t, cs]) => Object.keys(cs).map((c) => `${t}.${c}`));
    const regD = Object.entries(C.DATES).flatMap(([t, cs]) => cs.map((c) => `${t}.${c}`));
    expect(regI.sort()).toEqual(instants.sort());
    expect(regD.sort()).toEqual(dates.sort());
    for (const cs of Object.values(C.INSTANTS)) for (const k of Object.values(cs)) expect(['utc', 'local', 'input', 'iso']).toContain(k);
  });

  test('knows every foreign key of both schemas, and loads every parent before its rows', async () => {
    await ready;
    const edges = { ...pgForeignKeys() };
    for (const t of (await archive.describe(conn, conn.isPg)).values()) for (const fk of t.fks) edges[`${t.name}.${fk.col}`] = fk.parent;
    expect(C.FK_EDGES).toEqual(edges);
    const tables = [...new Set(Object.keys(edges).map((k) => k.split('.')[0]).concat(Object.values(edges)))];
    const order = archive.loadOrder(tables);
    for (const [k, parent] of Object.entries(edges)) expect(order.indexOf(parent)).toBeLessThan(order.indexOf(k.split('.')[0]));
  });

  test('times cross a change of clocks and come back as they were written', () => {
    const LA = 'America/Los_Angeles';
    const to = (raw, kind, defaultUtc) => C.instantToArchive(raw, kind, LA, defaultUtc).value;
    // 'local' text (nowLocal): either side of the spring change
    expect(to('2026-03-08 01:30:00', 'local')).toBe('2026-03-08T09:30:00.000Z');
    expect(to('2026-03-08 03:30:00', 'local')).toBe('2026-03-08T10:30:00.000Z');
    // the hour that happens twice in November: the first of them
    expect(to('2026-11-01 01:30:00', 'local')).toBe('2026-11-01T08:30:00.000Z');
    expect(C.instantFromArchive('2026-11-01T08:30:00.000Z', 'local', LA, 'sqlite')).toBe('2026-11-01 01:30:00');
    expect(C.instantFromArchive('2026-03-08T10:30:00.000Z', 'local', LA, 'sqlite')).toBe('2026-03-08 03:30:00');
    // 'utc' text (datetime('now'))
    expect(to('2026-09-30 17:00:05', 'utc')).toBe('2026-09-30T17:00:05.000Z');
    expect(C.instantFromArchive('2026-09-30T17:00:05.000Z', 'utc', LA, 'sqlite')).toBe('2026-09-30 17:00:05');
    // 'input' (a date-and-time field, local)
    expect(to('2026-07-04T18:45', 'input')).toBe('2026-07-05T01:45:00.000Z');
    expect(C.instantFromArchive('2026-07-05T01:45:00.000Z', 'input', LA, 'sqlite')).toBe('2026-07-04T18:45');
    // 'iso': zoned as it is; zone-less leftovers by the column's default
    expect(to('2026-09-08T23:42:00.000Z', 'iso')).toBe('2026-09-08T23:42:00.000Z');
    expect(to('2026-09-08T16:42', 'iso')).toBe('2026-09-08T23:42:00.000Z');
    expect(to('2026-09-08 16:42:00', 'iso', true)).toBe('2026-09-08T16:42:00.000Z');
    expect(to('2026-09-08 16:42:00+00', 'local')).toBe('2026-09-08T16:42:00.000Z');
    // Postgres takes ISO as it is; empty is empty; what isn't a time says so
    expect(C.instantFromArchive('2026-09-08T23:42:00.000Z', 'local', LA, 'pg')).toBe('2026-09-08T23:42:00.000Z');
    expect(C.instantToArchive('', 'local', LA)).toEqual({ value: null });
    expect(C.instantToArchive(null, 'utc', LA)).toEqual({ value: null });
    expect(C.instantToArchive('yesterday', 'local', LA).problem).toMatch(/isn't a time/);
    expect(C.dateToArchive('2026-09-30')).toEqual({ value: '2026-09-30' });
    expect(C.dateToArchive('2026-09-30T10:00')).toEqual({ value: '2026-09-30' });
    expect(C.dateToArchive('')).toEqual({ value: null });
    expect(C.dateToArchive('soon').problem).toMatch(/isn't a date/);
  });
});

// ── The round trip ──────────────────────────────────────────────────────────
describe('export, import into a new install, export again', () => {
  const fileA = path.join(TMP, 'exports', 'a.opspoint');
  const dirB = path.join(TMP, 'b');
  const fileB = path.join(TMP, 'b.opspoint');
  let seeded, A, exportA;

  beforeAll(async () => {
    await ready;
    fs.mkdirSync(path.dirname(fileA), { recursive: true });
    seeded = await seedEverything({ conn, isPg: conn.isPg, zone: ZONE, storage: storage() });
    exportA = await archive.exportArchive({
      conn, isPg: conn.isPg, file: fileA, passphrase: PASS, storage: storage(), zone: ZONE, profile: settings.profile().name,
    });
    A = await contents(fileA);
  });

  test('the export carries every table and photo, and leaves behind what belongs to this machine', async () => {
    const header = JSON.parse(A['header.json']);
    expect(header).toMatchObject({ app: 'opspoint-facility', appVersion: archive.APP_VERSION, format: format.FORMAT });
    expect(header.source).toMatchObject({ driver: conn.isPg ? 'pg' : 'sqlite', timeZone: ZONE, facility: 'Archive Test House' });
    const names = header.tables.map((t) => t.name);
    for (const t of C.EXCLUDED_TABLES) expect(names).not.toContain(t);
    for (const t of ['users', 'clients', 'reports', 'log_entries', 'ua_records', 'audit_log', 'settings', 'clinical_notes']) expect(names).toContain(t);
    expect(names.indexOf('users')).toBeLessThan(names.indexOf('clinical_notes'));
    if (conn.isPg) expect(header.tables.find((t) => t.name === 'clients').columns).not.toContain('room_sort');   // generated

    // Counts: what the database holds (settings: less what stays behind).
    const manifest = JSON.parse(A['manifest.json']);
    for (const t of names) {
      if (t === 'settings') continue;
      const n = Number((await conn.query1(`SELECT COUNT(*) AS n FROM "${t}"`)).n);
      expect([t, manifest.counts[t]]).toEqual([t, n]);
      expect(linesOf(A[`tables/${t}.jsonl`]).length).toBe(n);
    }
    const s = settingsOf(A);
    expect(JSON.parse(s.facility_name)).toBe('Archive Test House');
    for (const k of ['backup_dir', 'central_url', 'central_api_key', 'central_last_sync']) expect(s).not.toHaveProperty(k);
    const setup = JSON.parse(s.setup);
    expect(setup.admin_id).toBe(seeded.ids.users[0]);
    for (const k of ['code_hash', 'code_salt', 'code_created', 'code_expires']) expect(setup).not.toHaveProperty(k);

    // Photos: every file under photos/ but the probe; the one a record names but storage lacks is noted.
    expect(Object.keys(A).filter((k) => k.startsWith('photos/')).sort()).toEqual(['photos/client_a.jpg', 'photos/ua_b.jpg']);
    for (const [k, bytes] of Object.entries(seeded.photos)) expect(Buffer.compare(A[k], bytes)).toBe(0);
    expect(manifest.photos.missing).toEqual(['photos/gone.jpg']);
    expect(manifest.problems.count).toBe(0);
    // Instants as ISO UTC, and the 2 MB line intact.
    const log = rowsOf(A, 'log_entries');
    const cols = header.tables.find((t) => t.name === 'log_entries').columns;
    expect(log[0][cols.indexOf('created_at')]).toMatch(/^2026-03-08T\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(log[0][cols.indexOf('text')]).toHaveLength('Zoë ✓ '.length * 250000);
    expect(exportA.rows).toBe(Object.values(manifest.counts).reduce((a, b) => a + b, 0));
  });

  test('imports into a new SQLite install, and that install exports the same records', () => {
    const envB = installEnv(dirB);
    const imp = cli(['import', fileA, '--passphrase-stdin', '--json'], envB);
    expect(imp.status).toBe(0);
    const r = lastJson(imp.stdout);
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual(JSON.parse(A['manifest.json']).counts);
    expect(r.photos.count).toBe(2);
    expect(fs.readFileSync(path.join(dirB, 'photos', 'client_a.jpg')).equals(seeded.photos['photos/client_a.jpg'])).toBe(true);

    const exp = cli(['export', '--out', fileB, '--passphrase-stdin'], envB);
    expect(exp.status).toBe(0);
    return contents(fileB).then((B) => compareArchives(A, B));
  });

  test('refuses an install that already has records, and a wrong passphrase, changing nothing', () => {
    const again = cli(['import', fileA, '--passphrase-stdin'], installEnv(dirB));
    expect(again.status).toBe(1);
    expect(again.stdout).toMatch(/already has records/);
    expect(again.stdout).toMatch(/Nothing was imported/);

    const dirW = path.join(TMP, 'wrong');
    const wrong = cli(['import', fileA, '--passphrase-stdin'], installEnv(dirW), 'not the passphrase at all\n');
    expect(wrong.status).toBe(1);
    expect(wrong.stdout).toMatch(/passphrase doesn't open/);
    expect(fs.existsSync(path.join(dirW, 'x.db'))).toBe(false);          // stopped before any database was made
  });

  test('refuses an export from a newer OpsPoint', async () => {
    const f = path.join(TMP, 'newer.opspoint');
    const w = await format.createWriter(f, { passphrase: PASS });
    const h = w.entry('header.json');
    await h.write(JSON.stringify({ app: 'opspoint-facility', appVersion: '99.0.0', format: 1, createdAt: new Date().toISOString(), source: {}, tables: [] }));
    await h.end();
    const m = w.entry('manifest.json'); await m.write('{}'); await m.end();
    await w.finish();
    const r = cli(['import', f, '--passphrase-stdin'], installEnv(path.join(TMP, 'newer')));
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/OpsPoint 99\.0\.0, newer than this install/);
  });

  test('carries the link to HQ only when asked, and then queues everything for HQ again', async () => {
    const f = path.join(TMP, 'hq.opspoint');
    await archive.exportArchive({ conn, isPg: conn.isPg, file: f, passphrase: PASS, storage: storage(), zone: ZONE, includeHq: true });
    const s = settingsOf(await contents(f));
    expect(JSON.parse(s.central_url)).toBe('https://hq.example.test');
    expect(s).toHaveProperty('central_api_key');
    for (const k of ['backup_dir', 'central_last_sync']) expect(s).not.toHaveProperty(k);

    const plain = lastJson(cli(['import', f, '--passphrase-stdin', '--json'], installEnv(path.join(TMP, 'hq1'))).stdout);
    expect(plain.queuedForHq).toBe(0);
    const kept = lastJson(cli(['import', f, '--passphrase-stdin', '--json', '--keep-hq'], installEnv(path.join(TMP, 'hq2'))).stdout);
    expect(kept.ok).toBe(true);
    expect(kept.queuedForHq).toBeGreaterThan(0);
  });

  test('the drill restores an export into a scratch install, runs the health check there and removes it', () => {
    const dirD = path.join(TMP, 'drill-home');
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('opspoint-drill-')).length;
    const r = cli(['drill', path.dirname(fileA), '--passphrase-stdin'], installEnv(dirD));
    expect(r.stdout).toMatch(/Restored into a scratch install: \d+ tables/);
    expect(r.stdout).toMatch(/pass\s+Database/);
    expect(r.stdout).toMatch(/The drill passed/);
    expect(r.status).toBe(0);
    expect(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('opspoint-drill-')).length).toBe(before);
  });

  // On a Postgres run: the SQLite install's export goes into a new Postgres
  // schema — SQLite to Postgres, the plan's "done when" — and comes back the same.
  (conn.isPg ? test : test.skip)('into a new Postgres install too, and back out the same', async () => {
    const schema = `archive_${crypto.randomBytes(4).toString('hex')}`;
    await conn.run(`CREATE SCHEMA ${schema}`);
    try {
      const u = new URL(settings.get('DATABASE_URL'));
      u.searchParams.set('options', `-c search_path=${schema}`);
      const envC = installEnv(path.join(TMP, 'c'), {
        OPSPOINT_DB_DRIVER: 'pg', DATABASE_URL: u.toString(), PGSSLMODE: settings.get('PGSSLMODE'),
      });
      const imp = cli(['import', fileB, '--passphrase-stdin', '--json'], envC);
      expect(imp.status).toBe(0);
      expect(lastJson(imp.stdout).ok).toBe(true);
      const fileC = path.join(TMP, 'c.opspoint');
      const exp = cli(['export', '--out', fileC, '--passphrase-stdin'], envC);
      expect(exp.status).toBe(0);
      compareArchives(await contents(fileB), await contents(fileC));
    } finally {
      await conn.run(`DROP SCHEMA ${schema} CASCADE`);
    }
  });

  // Every table the same, row for row; the audit log keeps the first install's
  // lines first (the second adds its own: the import); settings the same keys.
  // Rows as name -> value, times cut to what SQLite's text keeps in that
  // column (seconds; minutes for a date-and-time field): Postgres keeps more.
  function normalRows(all, t) {
    const cols = JSON.parse(all['header.json']).tables.find((u) => u.name === t).columns;
    const kinds = C.INSTANTS[t] || {};
    return rowsOf(all, t).map((row) => {
      const o = {};
      cols.forEach((c, i) => {
        let v = row[i];
        if (kinds[c] && typeof v === 'string' && kinds[c] !== 'iso') v = v.slice(0, kinds[c] === 'input' ? 16 : 19);
        o[c] = v;
      });
      return JSON.stringify(Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {}));
    });
  }
  function compareArchives(X, Y) {
    const hx = JSON.parse(X['header.json']), hy = JSON.parse(Y['header.json']);
    expect(hy.tables.map((t) => t.name)).toEqual(hx.tables.map((t) => t.name));
    for (const t of hx.tables) {
      expect([...hy.tables.find((u) => u.name === t.name).columns].sort()).toEqual([...t.columns].sort());
      const x = normalRows(X, t.name), y = normalRows(Y, t.name);
      if (t.name === 'audit_log') { expect(y.slice(0, x.length)).toEqual(x); continue; }
      if (t.name === 'settings') { for (const l of x) expect(y).toContain(l); continue; }
      expect([t.name, y]).toEqual([t.name, x]);
    }
    const px = Object.keys(X).filter((k) => k.startsWith('photos/')).sort();
    expect(Object.keys(Y).filter((k) => k.startsWith('photos/')).sort()).toEqual(px);
    for (const k of px) expect(Buffer.compare(X[k], Y[k])).toBe(0);
  }

  test('a reference SQLite kept to a row long gone is carried as it was (Postgres would refuse it)', () => {
    if (conn.isPg) return;            // Postgres never held one
    const cols = JSON.parse(A['header.json']).tables.find((t) => t.name === 'ua_records').columns;
    expect(rowsOf(A, 'ua_records')[0][cols.indexOf('report_id')]).toBe(GONE);
  });
});
