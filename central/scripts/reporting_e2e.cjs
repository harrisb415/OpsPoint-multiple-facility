'use strict';
/* Regression test for reportOverview() aggregation against known ingested data.
 * Key guard: a UA "positive" is stored by the facility as result='fail' (the
 * facility uses pass/fail, NOT positive/negative), so HQ must count 'fail'.
 * Direct db calls, temp data dir, Windows-safe exit. */
const db = require('../db');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data_reporttest');
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } }

function upserts(rows) {
  return rows.map((r, i) => {
    const { __t, ...data } = r;
    return { id: i + 1, table_name: __t, row_id: data.id, op: 'upsert', data };
  });
}

fs.rmSync(DATA, { recursive: true, force: true });
db.init(path.join(DATA, 'central.db'));
const f = db.createFacility('Test House');

db.ingestRows(f.id, upserts([
  { __t: 'clients', id: 1, name: 'John Doe', is_active: 1, is_special: 0 },
  { __t: 'clients', id: 2, name: 'Jane Roe', is_active: 1, is_special: 0 },
  { __t: 'clients', id: 3, name: 'VACANT',   is_active: 1, is_special: 0 },
  // Facility stores pass/fail (fail = positive), plus non-pass/fail outcomes.
  { __t: 'ua_records', id: 1, result: 'fail' },
  { __t: 'ua_records', id: 2, result: 'fail' },
  { __t: 'ua_records', id: 3, result: 'fail' },
  { __t: 'ua_records', id: 4, result: 'pass' },
  { __t: 'ua_records', id: 5, result: 'pass' },
  { __t: 'ua_records', id: 6, result: 'pending' },
  { __t: 'incidents', id: 1, status: 'open' },
  { __t: 'incidents', id: 2, status: 'closed' },
]));

const ov = db.reportOverview();
const fac = ov.facilities.find(x => x.id === f.id);
ok(!!fac, 'facility present in overview');
ok(fac.residents === 2, 'residents = 2 (excludes VACANT) — got ' + fac.residents);
ok(fac.vacant === 1, 'vacant = 1 — got ' + fac.vacant);
ok(fac.ua_total === 6, 'ua_total = 6 — got ' + fac.ua_total);
ok(fac.ua_positive === 3, "ua_positive = 3 (result='fail') — got " + fac.ua_positive);
ok(fac.incidents_total === 2, 'incidents_total = 2 — got ' + fac.incidents_total);
ok(fac.incidents_open === 1, "incidents_open = 1 (status='open') — got " + fac.incidents_open);
ok(ov.totals.ua_positive === 3, 'org totals ua_positive = 3 — got ' + ov.totals.ua_positive);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(fail === 0 ? 0 : 1); }, 200);
