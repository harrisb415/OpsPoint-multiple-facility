// Central (HQ) ingest + fleet reporting.
//
// Central had no test coverage at all, and the Postgres port changed two things
// under it: the module now goes through server/db/connection.js instead of
// holding its own better-sqlite3 handle, and the fleet-report counts no longer
// use json_extract() — which does not exist on Postgres — but a driver-chosen
// accessor that returns text on both.
//
// That second change is the reason this file exists. Forcing SQLite's side to
// text means every literal is now quoted, and quoting is exactly the kind of
// change that silently returns zero rows instead of failing. The row payloads
// below are shaped the way a facility actually syncs them: raw SQLite values,
// so is_active/is_special arrive as the integers 0 and 1, not booleans.
'use strict';
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'opscentral_test_'));
process.env.CENTRAL_DATA = TMP;

const db = require('../central/db');

let facilityId;

beforeAll(async () => {
  await db.init(path.join(TMP, 'central.db'));
  const f = await db.createFacility('Test House');
  facilityId = f.id || (f.facility && f.facility.id);
  expect(facilityId).toBeTruthy();

  await db.ingestRows(facilityId, [
    { id: 1, table_name: 'clients',    row_id: 1, op: 'upsert', data: { name: 'Alice',  is_active: 1, is_special: 0 } },
    { id: 2, table_name: 'clients',    row_id: 2, op: 'upsert', data: { name: 'Bob',    is_active: 1, is_special: 0 } },
    { id: 3, table_name: 'clients',    row_id: 3, op: 'upsert', data: { name: 'VACANT', is_active: 1, is_special: 0 } },
    { id: 4, table_name: 'clients',    row_id: 4, op: 'upsert', data: { name: 'Carol',  is_active: 0, is_special: 0 } },
    { id: 5, table_name: 'clients',    row_id: 5, op: 'upsert', data: { name: 'Office', is_active: 1, is_special: 1 } },
    { id: 6, table_name: 'incidents',  row_id: 1, op: 'upsert', data: { status: 'open' } },
    { id: 7, table_name: 'incidents',  row_id: 2, op: 'upsert', data: { status: 'closed' } },
    { id: 8, table_name: 'ua_records', row_id: 1, op: 'upsert', data: { result: 'Fail' } },
    { id: 9, table_name: 'ua_records', row_id: 2, op: 'upsert', data: { result: 'pass' } },
  ]);
}, 60000);

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

describe('ingestRows', () => {
  test('reports what it stored and advances the sync cursor', async () => {
    const again = await db.ingestRows(facilityId, [
      { id: 10, table_name: 'clients', row_id: 6, op: 'upsert', data: { name: 'Dave', is_active: 1, is_special: 0 } },
    ]);
    expect(again.stored).toBe(1);
    expect(again.applied_through).toBe(10);
  });

  test('is idempotent — a replayed batch upserts rather than duplicating', async () => {
    const before = await db.facilityTableCounts(facilityId);
    await db.ingestRows(facilityId, [
      { id: 2, table_name: 'clients', row_id: 2, op: 'upsert', data: { name: 'Bob', is_active: 1, is_special: 0 } },
    ]);
    const after = await db.facilityTableCounts(facilityId);
    expect(after.total).toBe(before.total);
  });

  test('a delete removes the mirrored row', async () => {
    const before = await db.facilityTableCounts(facilityId);
    await db.ingestRows(facilityId, [
      { id: 11, table_name: 'clients', row_id: 6, op: 'delete' },
    ]);
    const after = await db.facilityTableCounts(facilityId);
    expect(after.total).toBe(before.total - 1);
  });
});

describe('fleet report counts (the json accessor)', () => {
  // Dave was added and then deleted above, so the roster is back to the
  // beforeAll fixture: Alice and Bob are the only countable residents.
  test('counts residents, excluding VACANT, inactive and special rooms', async () => {
    const r = (await db.reportOverview()).facilities[0];
    expect(r.residents).toBe(2);
    expect(r.vacant).toBe(1);
  });

  test('counts open incidents against the total', async () => {
    const r = (await db.reportOverview()).facilities[0];
    expect(r.incidents_open).toBe(1);
    expect(r.incidents_total).toBe(2);
  });

  test('counts a positive UA case-insensitively (facility stores pass/fail)', async () => {
    const r = (await db.reportOverview()).facilities[0];
    expect(r.ua_positive).toBe(1);
    expect(r.ua_total).toBe(2);
  });

  test('fleet totals aggregate the per-facility rows', async () => {
    const o = await db.reportOverview();
    expect(o.totals.facilities).toBe(1);
    expect(o.totals.residents).toBe(2);
    // Regression guard for the async conversion: reportOverview builds its rows
    // with an async map, so a missing Promise.all would leave `facilities` full
    // of pending promises and every total NaN or 0.
    expect(Number.isFinite(o.totals.rows_total)).toBe(true);
    expect(o.facilities[0].name).toBe('Test House');
  });
});
