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

Options
  --app central       HQ's settings instead of the facility app's
`;

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

function main() {
  const [cmd, sub] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--app');
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
