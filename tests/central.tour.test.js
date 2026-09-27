// Central (HQ) tour — every exported database function, exercised the way the
// HQ console and the facility sync use them, on whichever driver is configured.
//
// Companion to api.tour.test.js. central.ingest covers the sync cursor; this
// covers the rest of the surface, which had no tests at all — and so nothing
// noticed that migrations/pg/002 never got the facilities.upd_* columns the
// SQLite schema adds, leaving the HQ facility list broken on Postgres.
//
// Failures are collected rather than thrown, so one run lists them all.
'use strict';
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_central_tour_'));
process.env.CENTRAL_DATA = TMP;

const db = require('../central/db');

const problems = [];
async function step(name, fn) {
  try { return await fn(); }
  catch (e) { problems.push(`${name}: ${e.message}`); return undefined; }
}
const drain = () => problems.splice(0);

const ctx = {};

beforeAll(async () => {
  await db.init(path.join(TMP, 'central.db'));
}, 60000);

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

describe('central tour', () => {
  test('HQ admin accounts', async () => {
    const u = await step('createCentralUser', () => db.createCentralUser({ username: 'tourhq', display_name: 'Tour HQ', password: 'Tour!Passw0rd9' }));
    ctx.userId = u && u.id;
    await step('listCentralUsers', () => db.listCentralUsers());
    await step('countCentralUsers', () => db.countCentralUsers());
    await step('authUser', () => db.authUser('tourhq', 'Tour!Passw0rd9'));
    if (ctx.userId) {
      await step('getUser', () => db.getUser(ctx.userId));
      await step('setUserPassword', () => db.setUserPassword(ctx.userId, 'Tour!Passw0rd8'));
      await step('resetCentralUserPassword', () => db.resetCentralUserPassword(ctx.userId, 'Tour!Passw0rd7'));
    }
    await step('audit', () => db.audit({ actor: 'tourhq', action: 'tour.test', target: 'x', detail: 'd', ip: '127.0.0.1' }));
    await step('getAudit', () => db.getAudit(50));
    expect(drain()).toEqual([]);
  });

  test('facilities — enroll, list, check in, rotate, update status', async () => {
    const f = await step('createFacility', () => db.createFacility('Tour Facility'));
    ctx.facId = f && f.id;
    ctx.apiKey = f && f.apiKey;
    expect(ctx.facId).toBeTruthy();
    await step('listFacilities', () => db.listFacilities());
    await step('getFacility', () => db.getFacility(ctx.facId));
    await step('facilityByKey', () => db.facilityByKey(ctx.apiKey));
    await step('touchFacility', () => db.touchFacility(ctx.facId, { ip: '10.0.0.5', app_version: '2.6.1' }));
    await step('recordFacilityUpdateStatus', () => db.recordFacilityUpdateStatus(ctx.facId, { state: 'updated', attempted: '2.6.2', error: '' }));
    await step('setFacilityStatus disabled', () => db.setFacilityStatus(ctx.facId, 'disabled'));
    await step('setFacilityStatus active', () => db.setFacilityStatus(ctx.facId, 'active'));
    await step('rotateFacilityKey', () => db.rotateFacilityKey(ctx.facId));
    expect(drain()).toEqual([]);
  });

  test('sync ingest and reporting', async () => {
    await step('ingestRows', () => db.ingestRows(ctx.facId, [
      { id: 1, table_name: 'clients', row_id: 1, op: 'upsert', data: { name: 'Pat', is_active: 1, is_special: 0, created_at: '2026-09-27 04:22:33.92+00' } },
      { id: 2, table_name: 'clients', row_id: 2, op: 'upsert', data: { name: 'VACANT', is_active: 1, is_special: 0 } },
      { id: 3, table_name: 'incidents', row_id: 1, op: 'upsert', data: { status: 'open' } },
      { id: 4, table_name: 'ua_records', row_id: 1, op: 'upsert', data: { result: 'fail', tested_at: '2026-09-27T04:45:00.000Z' } },
      { id: 5, table_name: 'clients', row_id: 2, op: 'delete', data: null },
    ]));
    await step('getAppliedThrough', () => db.getAppliedThrough(ctx.facId));
    await step('facilityTableCounts', () => db.facilityTableCounts(ctx.facId));
    await step('getFacilityRows', () => db.getFacilityRows(ctx.facId, 'clients', 100));
    await step('reportOverview', () => db.reportOverview());
    expect(drain()).toEqual([]);
  });

  test('releases, rollout, fleet target', async () => {
    const rel = { channel: 'facility', version: '9.9.9', filename: 'opspoint-9.9.9.tar.gz', size: 1234, sha256: 'ab'.repeat(32), changelog: ['tour'], released: '2026-09-27', notes: '' };
    await step('recordRelease', () => db.recordRelease(rel));
    await step('recordRelease (no released date)', () => db.recordRelease({ ...rel, version: '9.9.8', released: '' }));
    await step('getRelease', () => db.getRelease('facility', '9.9.9'));
    await step('listReleases(channel)', () => db.listReleases('facility'));
    await step('listReleases()', () => db.listReleases());
    await step('getLatestPublishedRelease', () => db.getLatestPublishedRelease('facility'));
    await step('setReleaseStatus yanked', () => db.setReleaseStatus('facility', '9.9.8', 'yanked'));
    await step('startRollout', () => db.startRollout('facility', '9.9.9', [ctx.facId], 'tour rollout'));
    await step('getRollout', () => db.getRollout('facility'));
    await step('setRolloutState', () => db.setRolloutState('facility', 'active'));
    const fac = await step('getFacility (for directives)', () => db.getFacility(ctx.facId));
    if (fac) {
      await step('updateDirectiveFor', () => db.updateDirectiveFor(fac, 'https://hq.example'));
      await step('manifestReleaseFor', () => db.manifestReleaseFor(fac));
    }
    await step('evaluateRollout', () => db.evaluateRollout('facility'));
    await step('setFleetTarget', () => db.setFleetTarget('9.9.9', 'tour'));
    await step('getFleetTarget', () => db.getFleetTarget());
    expect(drain()).toEqual([]);
  });

  test('managed users', async () => {
    const m = await step('createManagedUser', () => db.createManagedUser({ username: 'tourpa', display_name: 'Tour PA', role: 'pa', password: 'Tour!Passw0rd9', facilities: [ctx.facId] }));
    const mid = m && m.id;
    await step('listManagedUsers', () => db.listManagedUsers());
    if (mid) {
      await step('getManagedUser', () => db.getManagedUser(mid));
      await step('updateManagedUser', () => db.updateManagedUser(mid, { display_name: 'Tour PA 2', role: 'supervisor', status: 'disabled' }));
      await step('setManagedUserPassword', () => db.setManagedUserPassword(mid, 'Tour!Passw0rd8'));
      await step('setManagedUserFacilities', () => db.setManagedUserFacilities(mid, [ctx.facId]));
      await step('getManagedUsersForFacility', () => db.getManagedUsersForFacility(ctx.facId));
      await step('deleteManagedUser', () => db.deleteManagedUser(mid));
    }
    if (ctx.userId) await step('deleteCentralUser', () => db.deleteCentralUser(ctx.userId));
    await step('deleteFacility', () => db.deleteFacility(ctx.facId));
    expect(drain()).toEqual([]);
  });
});
