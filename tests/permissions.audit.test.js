// The permission audit (scripts/perm-audit) as a test: no screen may offer an
// action the server refuses, every catalog action must run, and the server
// must enforce what each screen requires. Runs on either driver; for the full
// readable report run `node scripts/perm-audit.cjs`.
'use strict';
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const TMP_DB = path.join(os.tmpdir(), `opspoint_permtest_${Date.now()}.db`);
process.env.OPSPOINT_DB = TMP_DB;

const { app, db, ready } = require('../server');
const { audit, guardText } = require('../scripts/perm-audit/engine.cjs');
const catalog = require('../scripts/perm-audit/catalog.cjs');

let report;
const step = (s) => s ? `${s.verb} ${s.url.split('?')[0]} → ${s.status}${s.error ? ` ${s.error}` : ''}${s.route && s.route.guards.length ? ` (needs ${guardText(s.route.guards)})` : ''}` : '';

beforeAll(async () => {
  await ready;
  report = await audit({ app, db, catalog });
}, 30 * 60 * 1000);

afterAll(() => {
  ['', '-shm', '-wal'].forEach(s => { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } });
});

test('no screen offers an action the server refuses', () => {
  expect(report.conflicts.map(c => `${c.action.area} › ${c.action.label}: ${c.found.map(f => `as ${f.who}: ${step(f.step)}`).join('; ')}`)).toEqual([]);
});

test('every catalog action runs', () => {
  expect(report.errors.map(e => `${e.action.area} › ${e.action.label} (as ${e.who}): ${e.detail || step(e.step)}`)).toEqual([]);
});

test('the server enforces what each screen requires', () => {
  expect(report.notEnforced.map(n => `${n.action.area} › ${n.action.label}: allowed without ${n.lacking.join(' / ')}`)).toEqual([]);
});
