'use strict';
/* E2E for the row-level data browser (PHI) + audit logging.
 * Spawns a fresh central server, enrolls a facility, ingests rows (incl. a
 * resident name + inline photo), then exercises /stats and /rows and asserts
 * the PHI comes back and a phi.view audit entry is recorded. Windows-safe exit. */
const { spawn } = require('child_process');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 4577;
const DATA = path.join(__dirname, '..', 'data_phitest');
const PW0  = 'TempAdminPw0';
// 1x1 transparent PNG as a data: URI (stands in for a resident photo).
const PNG  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } }

let cookie = '';
function req(method, p, body, extra) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'connection': 'close', ...(extra || {}) };
    if (cookie) headers.cookie = cookie;
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    if (method !== 'GET') headers.origin = 'http://127.0.0.1:' + PORT;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, res => {
      const sc = res.headers['set-cookie'];
      if (sc && sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (e) {} resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitReady() {
  for (let i = 0; i < 60; i++) { try { const r = await req('GET', '/api/me'); if (r.status === 401 || r.status === 200) return true; } catch (e) {} await sleep(150); }
  return false;
}

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), CENTRAL_DATA: DATA, CENTRAL_ADMIN_PW: PW0 },
    stdio: 'ignore',
  });
  let code = 1;
  try {
    ok(await waitReady(), 'server booted');

    // Admin login + clear forced change.
    let r = await req('POST', '/login', { username: 'admin', password: PW0 });
    ok(r.status === 200, 'admin login');
    r = await req('POST', '/api/me/password', { password: 'AdminChosenPw1' });
    ok(r.status === 200, 'admin cleared must-change');

    // Enroll a facility, capture API key.
    r = await req('POST', '/api/facilities', { name: 'Maple House' });
    ok(r.status === 200 && r.body.apiKey, 'facility enrolled');
    const facId = r.body.facility.id, key = r.body.apiKey;

    // Ingest rows incl. PHI (resident names + a photo) via the node API.
    const rows = [
      { id: 1, table_name: 'clients', row_id: 10, op: 'upsert', data: { id: 10, room: '12', name: 'John Doe', is_active: 1, is_special: 0, photo: PNG } },
      { id: 2, table_name: 'clients', row_id: 11, op: 'upsert', data: { id: 11, room: '14', name: 'Jane Roe', is_active: 1, is_special: 0 } },
      { id: 3, table_name: 'reports', row_id: 5, op: 'upsert', data: { id: 5, report_date: '2026-06-06', shift: 'PM', mod_name: 'J. Smith', comments: 'all quiet' } },
    ];
    r = await req('POST', '/sync/ingest', { app_version: '2.3.3', rows }, { 'x-facility-key': key });
    ok(r.status === 200 && r.body.stored === 3, 'ingested 3 PHI rows via node API');

    // /stats → per-table counts.
    r = await req('GET', '/api/facilities/' + facId + '/stats');
    ok(r.status === 200 && r.body.total === 3, 'stats: 3 total rows');
    ok(r.body.tables && r.body.tables.clients === 2 && r.body.tables.reports === 1, 'stats: clients=2, reports=1');

    // /rows clients → resident names + photo present.
    r = await req('GET', '/api/facilities/' + facId + '/rows?table=clients');
    ok(r.status === 200 && Array.isArray(r.body.rows) && r.body.rows.length === 2, 'rows: 2 client records returned');
    const names = r.body.rows.map(x => x.data && x.data.name).sort();
    ok(names[0] === 'Jane Roe' && names[1] === 'John Doe', 'rows: resident PHI names present');
    const withPhoto = r.body.rows.find(x => x.data && x.data.photo);
    ok(withPhoto && typeof withPhoto.data.photo === 'string' && withPhoto.data.photo.startsWith('data:image/'), 'rows: inline photo data URI present');

    // limit param honored.
    r = await req('GET', '/api/facilities/' + facId + '/rows?table=clients&limit=1');
    ok(r.status === 200 && r.body.rows.length === 1, 'rows: limit=1 honored');

    // Validation: missing table / unknown facility.
    r = await req('GET', '/api/facilities/' + facId + '/rows');
    ok(r.status === 400, 'rows: missing table rejected (400)');
    r = await req('GET', '/api/facilities/does-not-exist/rows?table=clients');
    ok(r.status === 404, 'rows: unknown facility rejected (404)');

    // Audit: every /rows hit must record a phi.view entry for this facility.
    r = await req('GET', '/api/audit');
    const phi = (r.body.audit || []).filter(a => a.action === 'phi.view' && a.target === facId);
    ok(phi.length >= 1, 'audit: phi.view recorded for facility');
    ok(phi.some(a => /clients/.test(a.detail || '')), 'audit: phi.view detail names the table');
    ok(phi.some(a => a.actor === 'admin'), 'audit: phi.view attributes the admin actor');

    // Stats alone must NOT create a phi.view (only row reads do).
    const before = phi.length;
    await req('GET', '/api/facilities/' + facId + '/stats');
    r = await req('GET', '/api/audit');
    const after = (r.body.audit || []).filter(a => a.action === 'phi.view' && a.target === facId).length;
    ok(after === before, 'audit: /stats does not log a PHI view');

    console.log(`\n  ${pass} passed, ${fail} failed`);
    code = fail === 0 ? 0 : 1;
  } catch (e) {
    console.log('  ✗ threw:', e && e.message); code = 1;
  } finally {
    try { srv.kill(); } catch (e) {}
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(code); }, 200);
  }
})();
