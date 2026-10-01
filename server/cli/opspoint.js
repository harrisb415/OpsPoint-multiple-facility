#!/usr/bin/env node
'use strict';
/**
 * The OpsPoint command line:  node server/cli/opspoint.js <command>
 *
 * It lives under server/ so the in-app updater ships it with every release
 * (the updater copies server/ whole). The installers (roadmap phase 8) will put
 * it on the PATH as `opspoint`, next to the health check, backup and export.
 */
const USAGE = `Usage: node server/cli/opspoint.js <command> [options]

Commands
  settings            Every setting, its value and where it came from (secrets hidden)
  settings --check    Exit 0 if OpsPoint would start, 78 and the reasons if not
  settings --json     The same as JSON
  settings docs       Print docs/SETTINGS.md, generated from the settings schema
  doctor              Run the health check (the one Admin > System health shows):
                      exit 0 when nothing fails, 1 when something does (--json)
  migrate             Apply the Postgres migrations the database is missing (the deploy
                      step when OPSPOINT_MIGRATE=off). --status only lists them.
  keys                Print a new SESSION_SECRET and push key pair, as settings lines
                      (--json for JSON). Keep them secret; never commit them.
  setup-code          A new one-time code for /setup, while no account exists yet
                      (the one printed at first start expired or was lost)
  export              Every record and photo of this install, in one encrypted file:
                      --out <file or folder> (default: here), --include-hq keeps the link
                      to HQ (only for a copy that will replace this install)
  import <file>       Load an export into this new, empty install — SQLite or Postgres,
                      either way round; --keep-hq keeps the export's link to HQ
  drill <file|folder> Restore an export (the newest in a folder) into a scratch install,
                      run the health check there, then remove the scratch install

Options
  --app central       HQ's settings instead of the facility app's
  --passphrase-file f export, import, drill: the passphrase, from a file (else the setting
                      OPSPOINT_EXPORT_PASSPHRASE, else typed at the terminal)
`;

// Options followed by a value (which is then not a command word).
const VALUE_OPTIONS = ['--app', '--out', '--passphrase-file'];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] || '');
}
const flag = (name) => process.argv.includes(name);

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

function printSettings(d) {
  const who = d.app === 'central' ? 'HQ (central)' : 'the facility app';
  const lines = [];
  lines.push(`OpsPoint settings for ${who}`);
  lines.push(`  Profile    ${d.profile.name}${d.profile.inferred ? ' (inferred: OPSPOINT_PROFILE is not set)' : ` (from ${d.profile.source})`}`);
  if (d.file.disabled) lines.push('  File       none (OPSPOINT_CONFIG=none)');
  else if (d.file.found) lines.push(`  File       ${d.file.path}`);
  else if (d.file.path) lines.push(`  File       ${d.file.path} (not usable: see below)`);
  else lines.push('  File       none (no opspoint.config.json in the app folder)');
  lines.push(`  Time zone  ${d.timeZone.name}${d.timeZone.explicit ? ` (from ${d.timeZone.source})` : " (this machine's)"}`);
  const st = d.secrets;
  if (st.kind === 'local') lines.push('  Secrets    the environment and this machine (OPSPOINT_SECRETS=local)');
  else lines.push(`  Secrets    ${st.label}${st.loaded ? `: ${st.names.length ? st.names.join(', ') : 'none of them there'}` : ' (not read: see below)'}`);
  const w = Math.max(...d.settings.map((s) => s.name.length)) + 2;
  const vw = Math.min(46, Math.max(...d.settings.map((s) => s.value.length)) + 2);
  let group = null;
  for (const s of d.settings) {
    if (s.group !== group) { group = s.group; lines.push('', group); }
    const value = s.value.length + 2 > vw ? `${s.value}  ` : pad(s.value, vw);
    lines.push(`  ${pad(s.name, w)}${value}${s.source === 'unset' ? '' : s.source}`.trimEnd());
  }
  lines.push('');
  const errors = d.problems.filter((p) => p.level === 'error');
  const warnings = d.problems.filter((p) => p.level === 'warning');
  if (!d.problems.length) lines.push('No problems: OpsPoint would start with these settings.');
  for (const p of errors) lines.push(`ERROR    ${p.message}`);
  for (const p of warnings) lines.push(`warning  ${p.message}`);
  process.stdout.write(lines.join('\n') + '\n');
}

// `doctor`: the same checks as Admin › System health, from outside the server
// (the installers run it at the end). Reads the database; never creates or
// changes one. Exit 0 = nothing failed, 1 = something failed, 78 = settings.
// The secret store, read the way the server reads it as it starts. Returns
// the exit code for a failure (printed), or null.
function readStore(s) {
  const r = require('../settings').loadSecrets(s);
  if (r.ok) return null;
  process.stdout.write(`ERROR    ${r.message}\n`);
  return r.exitCode;
}

async function doctor() {
  const settings = require('../settings');
  const stop = readStore(settings.useApp('facility'));
  if (stop !== null) return stop;
  const bad = settings.check().filter((p) => p.level === 'error');
  if (bad.length) {
    for (const p of bad) process.stdout.write(`ERROR    ${p.message}\n`);
    return settings.EX_CONFIG;
  }
  const fs = require('fs');
  const config = require('../config');
  const conn = require('../db/connection');
  const health = require('../health');

  // SQLite would create a missing database file on open; say so instead.
  let opened = false;
  const missing = !conn.isPg && !fs.existsSync(config.DB_PATH);
  if (!missing) { conn.open(conn.isPg ? undefined : config.DB_PATH); opened = true; }
  const dbConn = missing
    ? { isPg: false, query: nope, query1: nope, run: nope }
    : conn;
  function nope() { return Promise.reject(new Error(`there is no database at ${config.DB_PATH} yet (OpsPoint creates it when it first starts)`)); }

  const readSetting = async (key, def) => {
    const row = await dbConn.query1('SELECT value FROM settings WHERE key=?', [key]);
    if (!row) return def;
    try { return JSON.parse(row.value); } catch (e) { return row.value; }
  };
  // The updater's manifest check, with the HQ relay's key when HQ serves it.
  const { createUpdater } = require('../../updater');
  const updater = createUpdater({
    baseDir: config.BASE, dataDir: config.DATA_DIR, dbPath: config.DB_PATH,
    db: { getSetting: readSetting, auditLog: async () => {} },
    broadcast: () => {}, restart: () => {},
    authFor: async (url) => {
      try {
        const cu = await readSetting('central_url', ''), key = await readSetting('central_api_key', '');
        if (cu && key && new URL(url).host === new URL(cu).host) return { 'x-facility-key': key };
      } catch (e) { /* no relay */ }
      return {};
    },
    insecureFor: async (url) => {
      try {
        const cu = await readSetting('central_url', '');
        return !!(cu && await readSetting('central_insecure_tls', false) && new URL(url).host === new URL(cu).host);
      } catch (e) { return false; }
    },
  });

  const d = health.createDoctor({ conn: dbConn, settings, config, updater });
  const r = await d.run({ fresh: true });
  try { if (opened) await conn.close(); } catch (e) { /* exiting anyway */ }

  if (flag('--json')) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    const mark = { pass: 'pass', warn: 'WARN', fail: 'FAIL', skip: 'skip' };
    const w = Math.max(...r.results.map((x) => x.label.length)) + 2;
    const lines = ['OpsPoint health check', ''];
    for (const x of r.results) {
      lines.push(`  ${mark[x.status].padEnd(6)}${pad(x.label, w)}${x.says}`);
      if (x.fix && (x.status === 'fail' || x.status === 'warn')) lines.push(`  ${' '.repeat(6 + w)}Fix: ${x.fix}`);
    }
    lines.push('', health.summaryLine(r).replace(/^./, (c) => c.toUpperCase()) + '.');
    process.stdout.write(lines.join('\n') + '\n');
  }
  return r.results.some((x) => x.status === 'fail') ? 1 : 0;
}

// `migrate`: bring the Postgres schema up to date (server/db/runner.js) — the
// same thing OpsPoint does as it starts with OPSPOINT_MIGRATE=start.
// Exit 0 = up to date, 1 = --status found some missing, 78 = settings or a
// migration failed (rolled back; the reason is printed).
async function migrateCmd(app) {
  const settingsModule = require('../settings');
  const s = settingsModule.useApp(app);
  const stop = readStore(s);
  if (stop !== null) return stop;
  const bad = s.check().filter((p) => p.level === 'error');
  if (bad.length) {
    for (const p of bad) process.stdout.write(`ERROR    ${p.message}\n`);
    return settingsModule.EX_CONFIG;
  }
  const conn = require('../db/connection');
  if (!conn.isPg) {
    process.stdout.write('SQLite: nothing to apply. OpsPoint builds its schema as it starts.\n');
    return 0;
  }
  const runner = require('../db/runner');
  conn.open(s.get(app === 'central' ? 'CENTRAL_DATABASE_URL' : 'DATABASE_URL'));
  const pool = conn.getDb();
  const who = app === 'central' ? 'HQ database' : 'facility database';
  try {
    if (flag('--status')) {
      const st = await runner.status({ pool, app });
      const lines = [`Migrations for the ${who}`];
      const pending = new Set(st.pending.map((f) => f.name)), changed = new Set(st.changed.map((f) => f.name));
      for (const f of st.files) {
        const mark = st.unrecorded ? 'unrecorded' : pending.has(f.name) ? 'PENDING' : changed.has(f.name) ? 'CHANGED' : 'applied';
        lines.push(`  ${pad(mark, 11)}${f.name}`);
      }
      if (st.fresh) lines.push('', 'A new, empty database: `migrate` applies every file.');
      else if (st.unrecorded) lines.push('', 'Nothing is recorded yet (it was migrated by hand): `migrate` notes what is there, once its schema matches the code.');
      else if (pending.size) lines.push('', `${pending.size} missing: run \`node server/cli/opspoint.js migrate${app === 'central' ? ' --app central' : ''}\`.`);
      else lines.push('', 'Up to date.');
      if (changed.size) lines.push(`Changed since they were applied: ${[...changed].join(', ')}. An applied file never runs again; add a new one instead.`);
      process.stdout.write(lines.join('\n') + '\n');
      return pending.size && !st.unrecorded ? 1 : 0;
    }
    const r = await runner.migrate({ pool, app, parity: runner.parityFor(app, pool), log: (m) => process.stdout.write(`  ${m}\n`) });
    process.stdout.write(r.fresh ? `A new ${who}: applied ${r.applied.length} migrations.\n`
      : r.applied.length ? `Applied ${r.applied.length} migration(s) to the ${who}.\n`
      : `The ${who} is up to date.\n`);
    return 0;
  } catch (e) {
    if (e && e.code === 'EX_CONFIG') { process.stdout.write(`ERROR    ${e.message}\n`); return settingsModule.EX_CONFIG; }
    throw e;
  } finally {
    await conn.close().catch(() => {});
  }
}

// `setup-code`: a new one-time setup code while no account exists yet (the
// one printed at first start expired, or the log is gone). The old code stops
// working. Exit 0 with the link and the code; 1 once setup is past the code.
async function setupCode() {
  const fs = require('fs');
  const settings = require('../settings');
  const stop = readStore(settings.useApp('facility'));
  if (stop !== null) return stop;
  const bad = settings.check().filter((p) => p.level === 'error');
  if (bad.length) {
    for (const p of bad) process.stdout.write(`ERROR    ${p.message}\n`);
    return settings.EX_CONFIG;
  }
  const config = require('../config');
  const conn = require('../db/connection');
  if (!conn.isPg && !fs.existsSync(config.DB_PATH)) {
    process.stdout.write('There is no database yet: start OpsPoint, and it prints a setup code as it starts.\n');
    return 1;
  }
  conn.open(conn.isPg ? undefined : config.DB_PATH);
  try {
    const setup = require('../modules/setup/service');
    const { state } = await setup.current();
    if (state !== 'code') {
      process.stdout.write(state === 'done' ? 'Setup is finished, so there is no setup code any more.\n'
        : 'The admin account exists already: sign in, then open /setup to finish.\n');
      return 1;
    }
    const r = await setup.newCode();
    const proto = require('../secrets').tlsFiles(config.DATA_DIR) ? 'https' : 'http';
    const until = new Date(r.expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    process.stdout.write(`Open ${proto}://localhost:${config.PORT}/setup (or this server's own address)\n` +
      `Setup code: ${r.code} (works once, until ${until}; the previous code no longer works)\n`);
    return 0;
  } finally {
    await conn.close().catch(() => {});
  }
}

// ── export / import / drill (server/archive) ────────────────────────────────
// Settings as the server reads them (with the secret store): null when they
// are fine, else the exit code (printed).
function settingsOrStop() {
  const settings = require('../settings');
  const stop = readStore(settings.useApp('facility'));
  if (stop !== null) return stop;
  const bad = settings.check().filter((p) => p.level === 'error');
  if (!bad.length) return null;
  for (const p of bad) process.stdout.write(`ERROR    ${p.message}\n`);
  return settings.EX_CONFIG;
}

function readAllStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// Typed at the terminal, not echoed.
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    rl._writeToOutput = () => {};
    rl.question('', (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

// The passphrase: --passphrase-file, --passphrase-stdin (what the drill hands
// its scratch import), the OPSPOINT_EXPORT_PASSPHRASE setting, or typed (twice
// for a new export). Null when there is no way to get one.
async function passphrase({ confirm = false } = {}) {
  const file = arg('--passphrase-file');
  if (file) {
    return require('../secrets').readFile(require('path').resolve(file),
      { what: `the passphrase file ${file}`, setting: 'OPSPOINT_EXPORT_PASSPHRASE' }).replace(/\r?\n$/, '');
  }
  if (flag('--passphrase-stdin')) return (await readAllStdin()).replace(/\r?\n$/, '');
  const fromSetting = require('../settings').get('OPSPOINT_EXPORT_PASSPHRASE');
  if (fromSetting) return fromSetting;
  if (!process.stdin.isTTY) return null;
  const p = await askHidden('Export passphrase: ');
  if (confirm && p.length >= 12 && (await askHidden('The same again: ')) !== p) {
    throw Object.assign(new Error("The two passphrases don't match."), { code: 'ARCHIVE' });
  }
  return p;
}
const NO_PASSPHRASE = 'No passphrase: set OPSPOINT_EXPORT_PASSPHRASE, pass --passphrase-file, or run this in a terminal and type it.\n';

const n0 = (n) => Number(n || 0).toLocaleString('en-US');
const mb = (b) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;
const when = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const driverName = (d) => (d === 'pg' ? 'Postgres' : 'SQLite');

// What could not be carried as it was, by column (no values: they may be records).
function problemLines(p, what) {
  if (!p || !p.count) return [];
  const by = {};
  for (const x of p.items) by[`${x.table}.${x.column}`] = (by[`${x.table}.${x.column}`] || 0) + 1;
  const cols = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ×${v}`).join(', ');
  return [`  ${n0(p.count)} value${p.count === 1 ? '' : 's'} ${what} (${cols}${Object.keys(by).length > 6 ? ', …' : ''}).`];
}

function auditRow(conn, action, label, detail) {
  const { nowLocal } = require('../lib/time');
  return conn.run('INSERT INTO audit_log (ts, actor_id, actor_name, ip, action, target_type, target_id, target_label, detail) VALUES (?,?,?,?,?,?,?,?,?)',
    [nowLocal(), null, 'command line', 'localhost', action, 'system', '', label, JSON.stringify(detail)]);
}

async function exportCmd() {
  const fs = require('fs'), path = require('path');
  const stop = settingsOrStop();
  if (stop !== null) return stop;
  const settings = require('../settings');
  const config = require('../config');
  const conn = require('../db/connection');
  if (!conn.isPg && !fs.existsSync(config.DB_PATH)) {
    process.stdout.write(`There is no database at ${config.DB_PATH}: nothing to export.\n`);
    return 1;
  }
  const pass = await passphrase({ confirm: true });
  if (!pass) { process.stdout.write(NO_PASSPHRASE); return 2; }
  const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  let out = path.resolve(arg('--out') || '.');
  // A folder (made if need be) gets a dated file in it; a name ending .opspoint is the file itself.
  if (!/\.opspoint$/i.test(out) && !fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  if (fs.existsSync(out) && fs.statSync(out).isDirectory()) out = path.join(out, `opspoint-export-${stamp}.opspoint`);

  conn.open(conn.isPg ? undefined : config.DB_PATH);
  const t0 = Date.now();
  try {
    const archive = require('../archive');
    process.stdout.write(`Exporting to ${out}\n`);
    const r = await archive.exportArchive({
      conn, isPg: conn.isPg, file: out, passphrase: pass, storage: require('../storage').storage(),
      zone: settings.timeZone().name, profile: settings.profile().name, includeHq: flag('--include-hq'),
      log: (l) => process.stdout.write(`${l}\n`),
    });
    await auditRow(conn, 'archive.export', 'Export written', {
      file: path.basename(out), rows: r.rows, photos: r.photos.count, includesHq: flag('--include-hq'), checksum: r.checksum,
    });
    const lines = ['',
      `Exported ${r.header.source.facility || 'this install'}: ${Object.keys(r.counts).length} tables, ${n0(r.rows)} rows, ${n0(r.photos.count)} photos, in ${((Date.now() - t0) / 1000).toFixed(1)} s.`,
      `  File      ${out} (${mb(r.bytes)}, encrypted)`,
      `  Checksum  ${r.checksum}`,
      ...problemLines(r.problems, "weren't what their column holds and are empty in the export"),
    ];
    if (r.photos.missing.length) lines.push(`  ${r.photos.missing.length} photo(s) named by a record are not in file storage (${r.photos.missing[0]}${r.photos.missing.length > 1 ? ', …' : ''}).`);
    if (r.header.includesHq) lines.push('  It keeps the link to HQ: import it only into the install that replaces this one.');
    lines.push('Keep the passphrase apart from the export: without it nobody can open the file.');
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } catch (e) {
    if (e && e.code === 'ARCHIVE') { process.stdout.write(`ERROR    ${e.message}\n`); return 1; }
    if (e && e.code === 'EEXIST') { process.stdout.write(`ERROR    There is a file at ${out} already: an export never replaces one.\n`); return 1; }
    throw e;
  } finally {
    await conn.close().catch(() => {});
  }
}

async function importCmd(file) {
  const fs = require('fs'), path = require('path'), util = require('util');
  if (!file) { process.stderr.write(USAGE); return 2; }
  const json = flag('--json');
  if (json) console.log = (...a) => process.stderr.write(util.format(...a) + '\n');   // stdout carries only the result
  const say = (s) => { if (!json) process.stdout.write(s); };
  const stop = settingsOrStop();
  if (stop !== null) return stop;
  const settings = require('../settings');
  const archive = require('../archive');
  file = path.resolve(file);
  if (!fs.existsSync(file)) { process.stdout.write(`ERROR    There is no file at ${file}.\n`); return 1; }
  const pass = await passphrase();
  if (!pass) { process.stdout.write(NO_PASSPHRASE); return 2; }

  let header;
  try {
    header = await archive.readHeader(file, pass);
    if (header.app !== archive.APP) throw new archive.ArchiveError("This isn't an export of an OpsPoint facility.");
    if (archive.compareVersions(header.appVersion, archive.APP_VERSION) > 0) {
      throw new archive.ArchiveError(`This export came from OpsPoint ${header.appVersion}, newer than this install (${archive.APP_VERSION}): update this install first.`);
    }
  } catch (e) {
    if (e && e.code === 'ARCHIVE') { process.stdout.write(`ERROR    ${e.message}\n`); return 1; }
    throw e;
  }
  const src = header.source || {};
  say(`Export of ${src.facility || 'a facility'}, written ${when(header.createdAt)} by OpsPoint ${header.appVersion} (${driverName(src.driver)}, ${src.profile || 'unknown profile'})\n`);

  // The database, built the way OpsPoint builds it at its first start.
  const config = require('../config');
  const conn = require('../db/connection');
  if (!conn.isPg) fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
  const db = require('../../db');
  try { await db.init(config.DB_PATH); }
  catch (e) {
    await conn.close().catch(() => {});
    if (e && e.code === 'EX_CONFIG') { process.stdout.write(`ERROR    ${e.message}\n`); return settings.EX_CONFIG; }
    throw e;
  }
  // The photos folder, as a first start makes it (the health check looks for it).
  if (settings.get('OPSPOINT_STORAGE') === 'local') fs.mkdirSync(path.join(settings.get('OPSPOINT_STORAGE_DIR'), 'photos'), { recursive: true });
  say(`Importing into this install (${driverName(conn.isPg ? 'pg' : 'sqlite')}, profile ${settings.profile().name})\n`);
  const t0 = Date.now();
  try {
    const r = await archive.importArchive({
      conn, isPg: conn.isPg, file, passphrase: pass, storage: require('../storage').storage(),
      zone: settings.timeZone().name, contentType: require('../storage/photos').contentType,
      keepHq: flag('--keep-hq'), syncTables: db.SYNC_TABLES, log: (l) => say(`${l}\n`),
    });
    await db.auditLog(null, 'command line', 'localhost', 'archive.import', 'system', '', `Imported an export of ${src.facility || 'a facility'}`, {
      file: path.basename(file), written: header.createdAt, fromVersion: header.appVersion, fromDriver: src.driver,
      rows: r.rows, photos: r.photos.count, emptied: r.problems.count, keptHq: flag('--keep-hq') && header.includesHq,
    });
    if (json) {
      process.stdout.write(JSON.stringify({
        ok: true, header, counts: r.counts, rows: r.rows, photos: r.photos, problems: r.problems.count, problemsByKind: r.problems.byKind,
        exportProblems: r.exportProblems.count, ownAudit: r.ownAudit, queuedForHq: r.queuedForHq,
      }) + '\n');
      return 0;
    }
    const ofKind = (kind) => ({ count: (r.problems.byKind || {})[kind] || 0, items: r.problems.items.filter((x) => x.kind === kind) });
    const lines = ['',
      `Imported ${n0(r.rows)} rows in ${Object.keys(r.counts).length} tables and ${n0(r.photos.count)} photos (${mb(r.photos.bytes)}) in ${((Date.now() - t0) / 1000).toFixed(1)} s: every count matches the export.`,
      ...problemLines(ofKind('dangling'), 'pointed at records the export no longer had and are left empty'),
      ...problemLines(ofKind('default'), "were empty where this database requires a value, and got the column's default"),
      ...problemLines(r.exportProblems, 'were already empty in the export (not what their column holds)'),
    ];
    if (r.ownAudit) lines.push(`  This install's own ${r.ownAudit} audit line(s) from before the import follow the export's.`);
    if (r.queuedForHq) lines.push(`  Kept the link to HQ: ${n0(r.queuedForHq)} rows are queued to send again.`);
    else if (header.includesHq && !flag('--keep-hq')) lines.push('  The export has a link to HQ, left out (pass --keep-hq when this install replaces that one).');
    lines.push('Start OpsPoint: everyone signs in with the password they had. Phone PINs and push alerts are set up again on each phone.');
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } catch (e) {
    if (e && e.code === 'ARCHIVE') {
      process.stdout.write(json ? JSON.stringify({ ok: false, error: e.message }) + '\n' : `ERROR    ${e.message}\nNothing was imported.\n`);
      return 1;
    }
    throw e;
  } finally {
    await conn.close().catch(() => {});
  }
}

// The health checks that speak about the restored data; the rest describe the
// scratch install's machine (no server running, no push keys made…).
const DRILL_CHECKS = ['database', 'migrations', 'storage', 'timezone'];

async function drillCmd(target) {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { spawnSync } = require('child_process');
  if (!target) { process.stderr.write(USAGE); return 2; }
  const stop = settingsOrStop();
  if (stop !== null) return stop;
  const settings = require('../settings');
  let file = path.resolve(target);
  if (!fs.existsSync(file)) { process.stdout.write(`ERROR    There is no file or folder at ${file}.\n`); return 1; }
  if (fs.statSync(file).isDirectory()) {
    const newest = fs.readdirSync(file).filter((f) => f.endsWith('.opspoint'))
      .map((f) => ({ f: path.join(file, f), t: fs.statSync(path.join(file, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    if (!newest) { process.stdout.write(`ERROR    There is no export (*.opspoint) in ${file}.\n`); return 1; }
    file = newest.f;
  }
  const pass = await passphrase();
  if (!pass) { process.stdout.write(NO_PASSPHRASE); return 2; }

  // A scratch install: SQLite in a temporary folder, none of this install's settings.
  const { BY_NAME } = require('../settings/schema');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint-drill-'));
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!BY_NAME[k] && !BY_NAME[k.replace(/_FILE$/, '')]) env[k] = v;
  Object.assign(env, {
    OPSPOINT_CONFIG: 'none', OPSPOINT_PROFILE: process.platform === 'win32' ? 'windows-local' : 'linux-local',
    OPSPOINT_DB_DRIVER: 'sqlite', OPSPOINT_DATA: tmp, OPSPOINT_DB: path.join(tmp, 'drill.db'),
    OPSPOINT_STORAGE: 'local', OPSPOINT_STORAGE_DIR: tmp, TZ: settings.timeZone().name,
    OPSPOINT_UPDATES: 'platform',            // a scratch install never updates (and its check stays off the network)
  });
  const run = (args, input) => spawnSync(process.execPath, [__filename, ...args], { env, input, encoding: 'utf8', maxBuffer: 64 << 20 });
  let passed = false, summary = '';
  process.stdout.write(`Drill: ${file}\n`);
  try {
    const imp = run(['import', file, '--passphrase-stdin', '--json'], `${pass}\n`);
    let r = null;
    try { r = JSON.parse(String(imp.stdout).trim().split('\n').pop()); } catch (e) { /* see below */ }
    if (imp.status !== 0 || !r || !r.ok) {
      summary = (r && r.error) || String(imp.stdout || imp.stderr || '').trim().split('\n').pop() || `exit ${imp.status}`;
      process.stdout.write(`FAILED   The export did not restore: ${summary}\n`);
      return 1;
    }
    const src = r.header.source || {};
    process.stdout.write(`  Export of ${src.facility || 'a facility'}, written ${when(r.header.createdAt)} by OpsPoint ${r.header.appVersion} (${driverName(src.driver)})\n` +
      `  Restored into a scratch install: ${Object.keys(r.counts).length} tables, ${n0(r.rows)} rows, ${n0(r.photos.count)} photos; every count matches.\n`);

    const doc = run(['doctor', '--json']);
    let h = null;
    try { h = JSON.parse(doc.stdout); } catch (e) { /* see below */ }
    if (!h) { process.stdout.write(`FAILED   The health check did not run on it: ${String(doc.stderr || doc.stdout).trim().split('\n').pop()}\n`); return 1; }
    const mark = { pass: 'pass', warn: 'WARN', fail: 'FAIL', skip: 'skip' };
    const w = Math.max(...h.results.map((x) => x.label.length)) + 2;
    const block = (xs) => xs.map((x) => `  ${mark[x.status].padEnd(6)}${pad(x.label, w)}${x.says}`).join('\n');
    const data = h.results.filter((x) => DRILL_CHECKS.includes(x.id)), other = h.results.filter((x) => !DRILL_CHECKS.includes(x.id));
    process.stdout.write(`Health check of the restored data:\n${block(data)}\n` +
      `  Not part of the drill (they describe the scratch install, where no server ran): ${other.map((x) => x.label).join(', ')}.\n`);
    passed = !data.some((x) => x.status === 'fail');
    summary = `${n0(r.rows)} rows, ${n0(r.photos.count)} photos`;
    process.stdout.write(passed ? 'The drill passed: the export restores, every count matches and its data checks pass.\n'
      : 'The drill FAILED: the restored data does not pass its health checks (above).\n');
    return passed ? 0 : 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.stdout.write('Scratch install removed.\n');
    // On record in this install's audit log, as a contingency-plan test.
    try {
      const config = require('../config');
      const conn = require('../db/connection');
      if (conn.isPg || fs.existsSync(config.DB_PATH)) {
        conn.open(conn.isPg ? undefined : config.DB_PATH);
        await auditRow(conn, 'archive.drill', passed ? 'Restore drill passed' : 'Restore drill failed', { file: path.basename(file), passed, result: summary });
        await conn.close();
      }
    } catch (e) { /* the drill's own result stands */ }
  }
}

function main() {
  const [cmd, sub] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !VALUE_OPTIONS.includes(all[i - 1]));
  const app = arg('--app') || 'facility';
  if (app !== 'facility' && app !== 'central') { process.stderr.write('--app must be facility or central\n'); return 2; }

  if (cmd === 'settings') {
    const settings = require('../settings');
    if (sub === 'docs') {
      process.stdout.write(require('../settings/docs').renderDocs());
      return 0;
    }
    if (sub) { process.stderr.write(USAGE); return 2; }
    const s = settings.useApp(app);
    const loaded = settings.loadSecrets(s);          // as the server does, first
    const storeProblem = loaded.ok ? [] : [{ level: 'error', setting: 'OPSPOINT_SECRETS', message: loaded.message }];
    if (flag('--check')) {
      const problems = [...storeProblem, ...s.check()];
      const errors = problems.filter((p) => p.level === 'error');
      for (const p of errors) process.stdout.write(`ERROR    ${p.message}\n`);
      for (const p of problems.filter((x) => x.level === 'warning')) process.stdout.write(`warning  ${p.message}\n`);
      if (errors.length) return !loaded.ok && errors.length === 1 ? loaded.exitCode : settings.EX_CONFIG;
      const prof = s.profile(), tz = s.timeZone();
      const from = loaded.label ? `, ${loaded.count} secret${loaded.count === 1 ? '' : 's'} from ${loaded.label}` : '';
      process.stdout.write(`OK: ${app === 'central' ? 'HQ' : 'OpsPoint'} would start (profile ${prof.name}, time zone ${tz.name}${from}).\n`);
      return 0;
    }
    const d = s.describe();
    d.problems = [...storeProblem, ...d.problems];
    if (flag('--json')) process.stdout.write(JSON.stringify(d, null, 2) + '\n');
    else printSettings(d);
    return d.problems.some((p) => p.level === 'error') ? settings.EX_CONFIG : 0;
  }

  if (cmd === 'doctor') return doctor();
  if (cmd === 'migrate') return migrateCmd(app);
  if (cmd === 'setup-code') return setupCode();
  if (cmd === 'export') return exportCmd();
  if (cmd === 'import') return importCmd(sub);
  if (cmd === 'drill') return drillCmd(sub);

  if (cmd === 'keys') {
    const crypto = require('crypto');
    const k = require('../lib/webpush').generateKeys();
    const keys = {
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      VAPID_PUBLIC_KEY: k.publicKey,
      VAPID_PRIVATE_KEY: k.privateKey,
    };
    if (flag('--json')) { process.stdout.write(JSON.stringify(keys, null, 2) + '\n'); return 0; }
    process.stdout.write('# New secrets for ONE OpsPoint install: put them in its secret store or settings file,\n' +
      '# never in git. Changing the push keys later cuts off every subscribed phone.\n' +
      Object.entries(keys).map(([n, v]) => `${n}=${v}`).join('\n') + '\n');
    return 0;
  }

  process.stdout.write(USAGE);
  return cmd && cmd !== 'help' && !flag('--help') ? 2 : 0;
}

if (require.main === module) {
  Promise.resolve(main()).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`${(e && e.message) || e}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
