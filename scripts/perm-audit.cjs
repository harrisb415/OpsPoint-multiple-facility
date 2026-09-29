#!/usr/bin/env node
'use strict';
/**
 * Permission audit — finds screens that offer an action the server then
 * refuses (and the reverse: actions the UI hides but the server never checks).
 *
 *   node scripts/perm-audit.cjs            report; exit 1 if anything conflicts
 *   node scripts/perm-audit.cjs --verbose  also list every action that passed
 *
 * Runs on a throwaway SQLite database in the temp folder — never the real one.
 * How it works and how to add an action: scripts/perm-audit/engine.cjs and
 * scripts/perm-audit/catalog.cjs. `npm test` runs the same audit
 * (tests/permissions.audit.test.js), and scripts/pg-audit.sh runs it on Postgres.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

// Always a throwaway SQLite database and data folder, whatever the environment
// says: the audit creates hundreds of accounts, residents and records, so it
// must never reach a real database — not even when run on the production box
// with its .env loaded. (On Postgres it runs through tests/ under pg-audit.sh,
// against that script's scratch database.)
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_permaudit_'));
const TMP_DB = path.join(TMP_DIR, 'audit.db');
delete process.env.DATABASE_URL;
process.env.OPSPOINT_CONFIG = 'none';   // nor a settings file's database, profile or folders
process.env.OPSPOINT_DB_DRIVER = 'sqlite';
process.env.OPSPOINT_DATA = TMP_DIR;
process.env.OPSPOINT_DB = TMP_DB;

const verbose = process.argv.includes('--verbose');

(async () => {
  const log = console.log;
  console.log = () => {};   // the server's boot banner and first-run passwords
  const { app, db, ready } = require('../server');
  await ready;
  console.log = log;

  const { audit, guardText } = require('./perm-audit/engine.cjs');
  const catalog = require('./perm-audit/catalog.cjs');
  process.stdout.write(`Permission audit: ${catalog.length} actions\n`);
  // A live counter only on a terminal; redirected to a file, just the report.
  const tty = process.stdout.isTTY;
  const r = await audit({ app, db, catalog, onProgress: (i, n) => { if (tty) process.stdout.write(`\r  running ${i}/${n}…`); } });
  if (tty) process.stdout.write('\r' + ' '.repeat(40) + '\r');

  const where = (a) => `      ${a.where}`;
  const step = (s) => s ? `${s.verb} ${s.url.split('?')[0]} → ${s.status}${s.error ? ` "${s.error}"` : ''}${s.route && s.route.guards.length ? ` (route needs ${guardText(s.route.guards)})` : ''}` : '';

  log(`\n${r.actions} actions, ${r.runs} runs\n`);

  log(`✗ CONFLICTS — the screen offers it, the server refuses: ${r.conflicts.length}`);
  for (const c of r.conflicts) {
    log(`\n  ${c.action.area} › ${c.action.label}`);
    log(where(c.action));
    for (const f of c.found) log(`      as ${f.who}: ${step(f.step)}`);
    log(`      roles affected today: ${c.roles.length ? c.roles.join(', ') : 'none (only custom permission groups)'}`);
  }

  log(`\n! NOT ENFORCED — the UI requires it, the server doesn't check: ${r.notEnforced.length}`);
  for (const n of r.notEnforced) {
    log(`\n  ${n.action.area} › ${n.action.label}`);
    log(where(n.action));
    log(`      a user without ${n.lacking.join(' / ')} could still do it`);
  }

  log(`\n? ERRORS — a step failed for another reason (fix the catalog or the code): ${r.errors.length}`);
  for (const e of r.errors) {
    log(`\n  ${e.action.area} › ${e.action.label}  (as ${e.who})`);
    log(`      ${e.detail || step(e.step)}`);
  }

  log(`\n○ ROUTES WITH A PERMISSION CHECK NO ACTION EXERCISES: ${r.uncovered.length}`);
  for (const u of r.uncovered) log(`      ${u.method} ${u.path}  (needs ${u.needs})`);

  if (verbose) {
    log(`\n✓ PASSED: ${r.passes.length}`);
    for (const p of r.passes) log(`      ${p.area} › ${p.label}`);
  } else {
    log(`\n✓ ${r.passes.length} actions work for every role and permission set that can see them.`);
  }

  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(r.conflicts.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
