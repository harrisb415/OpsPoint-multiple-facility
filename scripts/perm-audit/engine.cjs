'use strict';
/**
 * Permission audit engine.
 *
 * The bug it hunts: a screen offers an action, but saving it needs a
 * permission the screen never checked — the Conduct UA form once sent its
 * shift-log line in a second request that needed log.add and ua.request, so a
 * PA pressed Save and got "Permission denied".
 *
 * Each catalog action says when the UI shows it (`show`, any-of-all-of
 * permission sets) and performs the same requests the UI sends. For every set
 * in `show` the engine signs in as a user holding EXACTLY those permissions and
 * does the action for real, on a throwaway database; it does the same for each
 * built-in role that would see it. Any 401/403 is a CONFLICT. Then, as a user
 * holding every permission EXCEPT the ones `show` mentions, it does it again:
 * success there means the server never enforces what the UI requires
 * (NOT ENFORCED). Other failures are ERRORS — usually the catalog, sometimes a
 * real bug. Finally it lists routes with a permission guard that no action
 * touched, so the catalog can't quietly fall behind the server.
 */
const crypto = require('crypto');
const request = require('supertest');

const EVERYONE = [[]];
const TODAY = () => new Date().toLocaleDateString('en-CA');
const PW = 'PermAudit!Passw0rd9';
const LOOPBACK = ['::ffff:127.0.0.1', '127.0.0.1', '::1'];

// ── The server's route map, read from Express at run time ────────────────
// requirePermission / requireAnyPermission tag their guards with `requires`.
function routeMap(app) {
  const out = [];
  for (const layer of (app._router && app._router.stack) || []) {
    if (!layer.route) continue;
    const guards = layer.route.stack.map(s => s.handle && s.handle.requires).filter(Boolean);
    for (const method of Object.keys(layer.route.methods)) {
      out.push({ method: method.toUpperCase(), path: layer.route.path, guards, layer });
    }
  }
  return out;
}
const guardText = (guards) => guards.map(g => g.all ? g.all.join(' + ') : `one of ${g.any.join(' / ')}`).join(', ') || 'signed in';
function matchRoute(routes, method, url) {
  const path = url.split('?')[0];
  return routes.find(r => r.method === method && r.layer.match(path)) || null;
}
const satisfies = (perms, guards) => guards.every(g => g.all ? g.all.every(p => perms.includes(p)) : g.any.some(p => perms.includes(p)));

const idOf = (res, ...paths) => {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), res.body);
    if (v != null) return v;
  }
  return null;
};

// ── Fixtures, made by an all-permission admin before each run ───────────
function harness(admin, db) {
  let n = 0;
  const next = () => ++n;
  const must = async (res, what) => {
    if (res.status >= 400) throw new Error(`fixture ${what}: ${res.status} ${res.body && res.body.error || ''}`);
    return res;
  };
  const h = {
    admin, db, today: TODAY,
    // Fixture lookups go to the database: GET /api/data returns everything and
    // slows down as the audit's own fixtures pile up.
    async report() {
      const id = parseInt(await db.getSetting('active_report_id', null));
      if (id) {
        const r = await db.query1('SELECT is_closed FROM reports WHERE id=?', [id]);
        if (r && !r.is_closed) return id;
      }
      const nid = ((await db.query1('SELECT MAX(id) AS m FROM reports')) || {}).m + 1 || 1;
      await must(await admin.post('/api/data').send({ reports: [blankReport(nid)], active_report_id: nid }), 'open a report');
      return nid;
    },
    async closedReport() {
      const nid = ((await db.query1('SELECT MAX(id) AS m FROM reports')) || {}).m + 1 || 1;
      await must(await admin.post('/api/data').send({ reports: [{ ...blankReport(nid), is_closed: true }] }), 'closed report');
      return nid;
    },
    async currentReport(agent = admin) {
      const id = await h.report();
      const d = await agent.get('/api/data');
      return (d.body.reports || []).find(x => x.id === id) || blankReport(id);
    },
    async resident() {
      const k = next();
      const room = String(10000 + k);
      const r = await must(await admin.post('/api/clients').send({ name: `Audit Resident ${k}`, room }), 'resident');
      const id = idOf(r, 'id', 'client.id');
      return { id, name: `Audit Resident ${k}`, room };
    },
    async logEntry() {
      const reportId = await h.report();
      const r = await must(await admin.patch('/api/data').send({ reportId, log_entry: { time: '9:00 AM', text: `Audit line ${next()}` } }), 'log entry');
      return r.body.log_entry_id;
    },
    async pass(status = 'Out') {
      const c = await h.resident();
      const body = { client_id: c.id, name: c.name, room: c.room, departure: new Date(Date.now() - 3600000).toISOString(),
        return_date: new Date(Date.now() + 2 * 3600000).toISOString(), status: status === 'Returned' ? 'Out' : status, notes: '', ua_notes: '' };
      await must(await admin.post('/api/passes').send(body), 'pass');
      const p = await db.query1('SELECT * FROM passes WHERE client_id=? ORDER BY id DESC LIMIT 1', [c.id]);
      if (status === 'Returned') await must(await admin.put(`/api/passes/${p.id}`).send({ status: 'Returned' }), 'return pass');
      return { ...p, resident: c };
    },
    async mail(status = 'pending') {
      const c = await h.resident();
      await must(await admin.post('/api/mail').send({ clients: [{ client_id: c.id, notes: '', mail_type: 'letter' }] }), 'mail');
      const m = await db.query1('SELECT * FROM mail_log WHERE client_id=? ORDER BY id DESC LIMIT 1', [c.id]);
      if (status === 'approved') await must(await admin.put(`/api/mail/${m.id}/approve`).send({}), 'approve mail');
      return m;
    },
    async violation(status = 'pending') {
      const c = await h.resident();
      await must(await admin.post('/api/violations').send({ client_id: c.id, client_name: c.name, room: c.room, violation_date: TODAY(), description: 'Audit infraction', staff_name: 'Sam Staff', notes: '' }), 'violation');
      const v = await db.query1('SELECT * FROM violations WHERE client_id=? ORDER BY id DESC LIMIT 1', [c.id]);
      if (status === 'assigned') await must(await admin.put(`/api/violations/${v.id}/review`).send({ action: 'assign', consequence: 'Audit consequence' }), 'assign');
      return v;
    },
    async uaRequest() {
      const c = await h.resident();
      await must(await admin.post('/api/ua-requests').send({ client_id: c.id, client_name: c.name, room: c.room }), 'UA request');
      return await db.query1('SELECT * FROM ua_requests WHERE client_id=? AND acknowledged=0 ORDER BY id DESC LIMIT 1', [c.id]);
    },
    uaBody(c, over = {}) {
      return { client_id: c.id, client_name: c.name, room: c.room, tested_at: new Date().toISOString(), collection_method: 'observed',
        reason: 'random', result: 'pass', panel_results: { THC: 'neg', COC: 'neg' }, witnessed_by_name: 'Audit', notes: '', log_time: '9:30 AM', ...over };
    },
    async uaRecord() {
      await h.report();
      const c = await h.resident();
      const r = await must(await admin.post('/api/ua-records').send(h.uaBody(c)), 'UA record');
      return { id: idOf(r, 'record.id'), logEntryId: r.body.log_entry_id };
    },
    async incident({ locked = false } = {}) {
      const c = await h.resident();
      const r = await must(await admin.post('/api/incidents').send({ client_id: c.id, incident_date: TODAY(), incident_time: '', narrative: 'Audit incident',
        severity: 'low', incident_type: 'Behavior', corrective_action: '', notifications_required: [] }), 'incident');
      const id = idOf(r, 'record.id', 'id');
      if (locked) await db.run('UPDATE incidents SET locked_at=? WHERE id=?', [new Date().toISOString(), id]);
      return id;
    },
    async milestone({ locked = false } = {}) {
      const c = await h.resident();
      const r = await must(await admin.post('/api/milestones').send({ client_id: c.id, phase: 'phase1', objective: 'Audit milestone', target_date: '', notes: '' }), 'milestone');
      const id = idOf(r, 'record.id', 'id');
      if (locked) await db.run('UPDATE milestones SET locked_at=? WHERE id=?', [new Date().toISOString(), id]);
      return id;
    },
    async consent() {
      const c = await h.resident();
      const r = await must(await admin.post('/api/consent-records').send({ client_id: c.id, recipient_name: 'Audit Agency', recipient_org: '', purpose: 'Audit',
        information_type: 'all', effective_date: TODAY(), expiration_date: '', signature_on_file: true }), 'consent');
      return { id: idOf(r, 'record.id', 'id'), clientId: c.id };
    },
    clinicalBody(seg, clientId) {
      return {
        notes: { client_id: clientId, note_type: 'progress', note_date: TODAY(), content: 'Audit note' },
        'treatment-plans': { client_id: clientId, plan_date: TODAY(), target_date: '', review_date: '', presenting_problem: 'x', goals: [{ text: 'goal' }], strengths: '', barriers: '', status: 'active' },
        assessments: { client_id: clientId, assessment_type: 'risk', assessment_date: TODAY(), content: { q: 'a' }, score: '', score_label: '' },
        'discharge-summaries': { client_id: clientId, discharge_date: TODAY(), admission_date: '', discharge_type: 'planned', discharge_to: '', presenting_problem: '', treatment_summary: '', progress_toward_goals: '', aftercare_plan: '', follow_up_date: '' },
        'group-notes': { group_name: 'Audit Group', session_date: TODAY(), topic: 'Topic', content: 'Content', attendees: [{ client_id: clientId, participation: 'present' }] },
      }[seg];
    },
    async clinical(seg) {
      const c = await h.resident();
      const r = await must(await admin.post(`/api/clinical/${seg}`).send(h.clinicalBody(seg, c.id)), `clinical ${seg}`);
      return { id: idOf(r, 'record.id', 'id'), clientId: c.id };
    },
    async staff() {
      const r = await must(await admin.post('/api/staff').send({ name: `Audit Staff ${next()}`, category: 'Other', phone: '', phone2: '', notes: '' }), 'staff');
      return idOf(r, 'id', 'staff.id', 'member.id');
    },
    async round() {
      await h.report();
      const cur = await admin.get('/api/rounds/current');
      const open = cur.body && (cur.body.round || cur.body.current);
      if (open && open.id) await admin.post(`/api/rounds/${open.id}/finish`).send({});
      const r = await must(await admin.post('/api/rounds').send({}), 'round');
      return idOf(r, 'round.id', 'id');
    },
    async missingFromFinishedRound() {
      const c = await h.resident();
      const id = await h.round();
      await must(await admin.put(`/api/rounds/${id}/marks/${c.id}`).send({ mark: 'missing' }), 'mark missing');
      await must(await admin.post(`/api/rounds/${id}/finish`).send({}), 'finish round');
      return { roundId: id, clientId: c.id };
    },
    async room() {
      const r = await must(await admin.post('/api/facility/rooms').send({ room: String(60000 + next()) }), 'room');
      return idOf(r, 'id', 'room.id', 'client.id');
    },
    async user() {
      const k = next();
      await must(await admin.post('/api/users').send({ username: `audit_target_${k}`, displayName: `Audit Target ${k}`, password: 'Target!Passw0rd8', role: 'pa', groupIds: [] }), 'user');
      return (await db.query1('SELECT id FROM users WHERE username=?', [`audit_target_${k}`])).id;
    },
    async group() {
      const r = await must(await admin.post('/api/groups').send({ key: `audit_grp_${next()}`, label: 'Audit Group', permissions: ['log.add'] }), 'group');
      return idOf(r, 'group.id', 'id');
    },
  };
  return h;
}
function blankReport(id) {
  return { id, report_date: TODAY(), shift: 'Swing Shift', mod_name: '', is_closed: false, statuses: {}, comments: {},
    last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] };
}

// ── The run ──────────────────────────────────────────────────────────────
async function audit({ app, db, catalog, roles = ['pa', 'supervisor', 'admin', 'case_manager'], onProgress = () => {} }) {
  const { loginRateClear, apiRateClear } = require('../../server/middleware/rateLimit');
  const clearRates = () => { for (const ip of LOOPBACK) loginRateClear(ip); apiRateClear(); };
  const ALL = db.PERMISSIONS.slice();
  const routes = routeMap(app);

  // One stored hash for every audit account: 600,000 rounds once, not per user.
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(PW, salt, 600000, 64, 'sha512').toString('hex');
  const agents = new Map();
  let seq = 0;
  async function agentFor(perms, role = 'pa', { fresh = false } = {}) {
    const key = `${role}|${perms.slice().sort().join(',')}`;
    if (!fresh && agents.has(key)) return agents.get(key);
    const username = `permaudit_${++seq}`;
    await db.run(
      `INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES (?,?,?,?,?,0,?,0)`,
      [username, `Perm Audit ${seq}`, role, hash, salt, JSON.stringify(perms)]);
    const agent = request.agent(app);
    clearRates();
    const r = await agent.post('/api/login').send({ username, password: PW });
    if (r.status !== 200) throw new Error(`audit login failed for ${key}: ${r.status}`);
    if (!fresh) agents.set(key, agent);
    return agent;
  }

  const admin = await agentFor(ALL, 'admin');
  const h = harness(admin, db);
  const touched = new Set();

  function recorder(agent, log) {
    const call = (m, verb) => async (url, body) => {
      let req = agent[m](url);
      if (body !== undefined) req = req.send(body);
      const res = await req;
      const route = matchRoute(routes, verb, url);
      if (route) touched.add(`${route.method} ${route.path}`);
      log.push({ verb, url, status: res.status, error: res.body && res.body.error, route });
      return res;
    };
    return { get: call('get', 'GET'), post: call('post', 'POST'), put: call('put', 'PUT'), patch: call('patch', 'PATCH'), del: call('delete', 'DELETE') };
  }

  async function runOnce(action, perms, role, opts = {}) {
    clearRates();
    const log = [];
    let ret;
    try {
      const agent = await agentFor(perms, role, { fresh: !!action.freshUser });
      const fx = action.setup ? await action.setup(h) : {};
      ret = await action.run(recorder(agent, log), fx, h);
    } catch (e) {
      return { outcome: 'error', detail: e.message, log };
    }
    // A probe returns false when the server held firm without a 403.
    if (ret === false) return { outcome: 'refused', step: log[log.length - 1], log };
    const refused = log.find(l => l.status === 401 || l.status === 403);
    if (refused) return { outcome: 'refused', step: refused, log };
    const failed = log.find(l => l.status >= 400);
    if (failed) return { outcome: 'error', step: failed, log };
    return { outcome: 'ok', log };
  }

  const report = { actions: catalog.length, runs: 0, conflicts: [], notEnforced: [], errors: [], passes: [], uncovered: [], notes: [] };
  const presets = Object.fromEntries(roles.map(r => [r, db.ROLE_PRESETS[r] || []]));
  const shows = (action, perms) => action.show.some(set => set.every(p => perms.includes(p)));

  for (const [i, action] of catalog.entries()) {
    onProgress(i + 1, catalog.length, action);
    if (action.note) report.notes.push({ action, note: action.note });
    const found = [];

    if (action.staticRoute) {
      // Too destructive to run (restart, reset, update): compare the gates instead.
      const [verb, path] = action.staticRoute;
      const route = routes.find(r => r.method === verb && r.path === path);
      if (!route) { report.errors.push({ action, who: '—', detail: `no route ${verb} ${path}` }); continue; }
      touched.add(`${route.method} ${route.path}`);
      for (const set of action.show) {
        if (!satisfies(set, route.guards)) found.push({ who: label(set), step: { verb, url: path, status: 403, error: `needs ${guardText(route.guards)}` } });
      }
      if (found.length) report.conflicts.push({ action, found, roles: roles.filter(r => shows(action, presets[r]) && !satisfies(presets[r], route.guards)) });
      else report.passes.push(action);
      continue;
    }

    const affected = [];
    for (const set of action.probeOnly ? [] : action.show) {
      report.runs++;
      const r = await runOnce(action, set, 'pa');
      if (r.outcome === 'refused') found.push({ who: label(set), step: r.step });
      else if (r.outcome === 'error') report.errors.push({ action, who: label(set), detail: r.detail, step: r.step });
    }
    for (const role of action.probeOnly ? [] : roles) {
      if (!shows(action, presets[role])) continue;
      report.runs++;
      const r = await runOnce(action, presets[role], role);
      if (r.outcome === 'refused') { affected.push(role); if (!found.length) found.push({ who: `role ${role}`, step: r.step }); }
      else if (r.outcome === 'error') report.errors.push({ action, who: `role ${role}`, detail: r.detail, step: r.step });
    }
    if (found.length) report.conflicts.push({ action, found, roles: affected });

    if (action.reverse !== false && action.show.some(s => s.length)) {
      const mentioned = new Set(action.show.flat());
      const rest = ALL.filter(p => !mentioned.has(p));
      report.runs++;
      const r = await runOnce(action, rest, 'pa');
      if (r.outcome === 'ok') report.notEnforced.push({ action, lacking: [...mentioned], log: r.log });
    }
    if (!found.length) report.passes.push(action);
  }

  for (const r of routes) {
    if (!r.guards.length) continue;
    if (!touched.has(`${r.method} ${r.path}`)) report.uncovered.push({ method: r.method, path: r.path, needs: guardText(r.guards) });
  }
  return report;
}
const label = (set) => set.length ? `only ${set.join(' + ')}` : 'no permissions (shown to everyone)';

module.exports = { audit, EVERYONE, TODAY, guardText };
