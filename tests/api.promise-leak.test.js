// Regression guard for the Postgres port's async conversion.
//
// Every database call became a promise, so any call site that forgot an `await`
// now puts a Promise where a value used to be. When that reaches a response it
// is silent: JSON.stringify(Promise) is '{}', so the endpoint still returns 200
// and the client simply sees an empty object. That is exactly how the facility
// settings endpoint started reporting facility_theme as {} instead of 'indigo'.
//
// Rather than trust a static sweep, this drives the real API as a fully
// privileged user and walks every response body looking for that shape. It is
// deliberately broad: the point is to catch the sites nobody thought to check.
//
// A legitimately empty object would be a false positive; none of these
// endpoints return one today. If one ever does, exempt that path explicitly
// rather than weakening the walk.
'use strict';
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

process.env.OPSPOINT_DB = path.join(os.tmpdir(), `opspoint_leak_${Date.now()}.db`);

const request = require('supertest');
const { app, db, ready } = require('../server');

const PW = 'Passw0rd!';

// Every permission, so no endpoint 403s and drops out of the scan.
const ALL_PERMS = [
  'admin.users', 'admin.settings', 'admin.system', 'facility.manage', 'residents.edit',
  'staff.edit', 'chores.edit', 'passes.edit', 'mail.log', 'mail.approve', 'ua.request',
  'ua.acknowledge', 'reports.create', 'reports.close', 'log.add', 'issues.edit',
  'status.edit', 'groups.view', 'groups.log', 'clinical.notes', 'clinical.treatment',
  'clinical.assessments', 'clinical.groups', 'clinical.discharge', 'violations.edit',
  'consent.manage', 'milestones.edit',
];

const ENDPOINTS = [
  '/api/me', '/api/data', '/api/facility/settings', '/api/users', '/api/staff',
  '/api/passes', '/api/mail', '/api/ua-requests', '/api/chore-log', '/api/master-chores',
  '/api/permission-profiles', '/api/audit-log', '/api/clinical/notes',
  '/api/clinical/group-notes', '/api/clinical/treatment-plans', '/api/clinical/assessments',
  '/api/clinical/discharge-summaries', '/api/heartbeat', '/api/pass-notice',
  '/api/staff/categories', '/api/facility/rooms',
];

// Collect the paths of every empty object in the tree. Arrays are traversed but
// an empty array is fine — only `{}` is the Promise signature.
function emptyObjectPaths(value, where, found) {
  if (value === null || typeof value !== 'object') return;
  if (!Array.isArray(value) && Object.keys(value).length === 0) { found.push(where); return; }
  for (const [k, v] of Object.entries(value)) emptyObjectPaths(v, `${where}.${k}`, found);
}

let agent;

beforeAll(async () => {
  await ready;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  await db.run(
    `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected)
     VALUES (?,?,?,?,?,0,?,0)`,
    ['leakscan', 'leakscan', 'admin', hash, salt, JSON.stringify(ALL_PERMS)]
  );
  agent = request.agent(app);
  const login = await agent.post('/api/login').send({ username: 'leakscan', password: PW });
  expect(login.status).toBe(200);
}, 60000);

test('no endpoint returns a serialized Promise, and none 500s', async () => {
  const problems = [];
  for (const url of ENDPOINTS) {
    const r = await agent.get(url);
    // A 500 here means an async handler rejected — usually a missing await too.
    if (r.status >= 500) { problems.push(`${url} -> HTTP ${r.status}`); continue; }
    if (r.status !== 200) continue;   // 403/404 are a permission/route matter, not a leak
    const found = [];
    emptyObjectPaths(r.body, url, found);
    for (const f of found) problems.push(`serialized Promise (empty object) at ${f}`);
  }
  expect(problems).toEqual([]);
}, 60000);
