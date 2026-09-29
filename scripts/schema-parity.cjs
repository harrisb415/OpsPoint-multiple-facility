#!/usr/bin/env node
'use strict';
/**
 * schema-parity.cjs — does the Postgres schema have everything SQLite has?
 *
 * The SQLite schema is built by code (CREATE TABLE in server/db/migrate.js plus
 * additive ALTERs in COLUMN_MIGRATIONS, db.js and central/db.js _migrate()); the
 * Postgres one by hand-written files in migrations/pg/. Nothing kept them in
 * step: central's facilities.upd_* columns lived only on the SQLite side, and
 * the HQ facility list failed on Postgres for weeks before anyone opened it.
 *
 * This boots both apps on throwaway SQLite databases, reads the resulting
 * columns, and compares them with a live Postgres schema. Exit 1 on a table or
 * column that is missing from Postgres; nullability/default differences are
 * printed as warnings (a NOT NULL column with no default that SQLite left
 * nullable is where '' and missing fields turn into 500s).
 *
 *   DATABASE_URL=… CENTRAL_DATABASE_URL=… node scripts/schema-parity.cjs
 *
 * Point it at a scratch database with migrations/pg applied to check the
 * migration FILES (scripts/pg-audit.sh does), or at production to check what
 * is actually deployed. The comparison itself lives in
 * server/health/schemaParity.js, which the health check uses too.
 */
const parity = require('../server/health/schemaParity');

(async () => {
  // From the environment or the settings file, like the apps themselves.
  const settings = require('../server/settings');
  const targets = [['facility', settings.forApp('facility').get('DATABASE_URL')],
                   ['central', settings.forApp('central').get('CENTRAL_DATABASE_URL')]];
  let failed = false;
  for (const [which, url] of targets) {
    if (!url) { console.log(`${which}: skipped (no ${which === 'facility' ? 'DATABASE_URL' : 'CENTRAL_DATABASE_URL'})`); continue; }
    const { errors, warnings } = parity.compare(which, parity.codeSchema(which), await parity.pgSchema(url));
    for (const w of warnings) console.log('  warn ', w);
    for (const e of errors) console.log('  FAIL ', e);
    console.log(`${which}: ${errors.length ? errors.length + ' missing' : 'OK'}${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
    if (errors.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(2); });
