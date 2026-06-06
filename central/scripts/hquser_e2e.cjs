'use strict';
/* E2E for HQ admin accounts + change-password + must-change enforcement.
 * Spawns a fresh central server on a test port/data dir, exercises the flow,
 * asserts behavior, then tears down. Windows-safe exit (drain then exit). */
const { spawn } = require('child_process');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT  = 4566;
const DATA  = path.join(__dirname, '..', 'data_hqtest');
const PW0   = 'TempAdminPw0';        // seeded first-run password (env)
const PW1   = 'BrendanNewPw123';     // admin's chosen password
const PW2   = 'SecondAdminPw9';      // 2nd admin temp password
const PW2b  = 'SecondChosenPw9';     // 2nd admin chosen password

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } }

let cookie = '';
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'connection': 'close' };
    if (cookie) headers.cookie = cookie;
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    if (method !== 'GET') headers.origin = 'http://127.0.0.1:' + PORT; // pass CSRF (host auto-matches)
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

    // 1) Login with seeded password → must_change_pw flagged.
    let r = await req('POST', '/login', { username: 'admin', password: PW0 });
    ok(r.status === 200 && r.body && r.body.user, 'login with seeded password');
    ok(r.body && r.body.user && r.body.user.must_change_pw === true, 'seeded admin flagged must_change_pw');

    // 2) Server-side enforcement: other admin APIs blocked until pw changed.
    r = await req('GET', '/api/central-users');
    ok(r.status === 403 && r.body && r.body.must_change_pw === true, 'admin API blocked while must_change_pw set');
    r = await req('GET', '/api/facilities');
    ok(r.status === 403, 'facilities API also blocked while must_change_pw set');

    // 3) Change own password (too-short rejected, then accepted).
    r = await req('POST', '/api/me/password', { password: 'short' });
    ok(r.status === 400, 'short password rejected');
    r = await req('POST', '/api/me/password', { password: PW1 });
    ok(r.status === 200, 'own password changed');

    // 4) Flag cleared; APIs now work.
    r = await req('GET', '/api/me');
    ok(r.status === 200 && r.body.must_change_pw === false, 'must_change_pw cleared after change');
    r = await req('GET', '/api/central-users');
    ok(r.status === 200 && Array.isArray(r.body.users) && r.body.users.length === 1, 'admin API works; 1 admin listed');
    ok(r.body.me === r.body.users[0].id, 'me id matches the sole admin');

    // 5) Old seeded password no longer works.
    cookie = '';
    r = await req('POST', '/login', { username: 'admin', password: PW0 });
    ok(r.status === 401, 'old seeded password rejected');
    r = await req('POST', '/login', { username: 'admin', password: PW1 });
    ok(r.status === 200 && r.body.user.must_change_pw === false, 're-login with new password, no forced change');

    // 6) Create a second HQ admin (validation + success).
    r = await req('POST', '/api/central-users', { username: 'Bad Name', password: PW2 });
    ok(r.status === 400, 'invalid username rejected');
    r = await req('POST', '/api/central-users', { username: 'jsmith', password: 'short' });
    ok(r.status === 400, 'short temp password rejected');
    r = await req('POST', '/api/central-users', { username: 'jsmith', display_name: 'J Smith', password: PW2 });
    ok(r.status === 200 && r.body.user && r.body.user.must_change_pw === true, 'second admin created, must_change flagged');
    const id2 = r.body.user.id;
    r = await req('POST', '/api/central-users', { username: 'jsmith', password: PW2 });
    ok(r.status === 400, 'duplicate username rejected');

    // 7) Lock-out rails: cannot delete self.
    r = await req('GET', '/api/central-users');
    const meId = r.body.me;
    r = await req('DELETE', '/api/central-users/' + meId);
    ok(r.status === 400, 'cannot delete own account');

    // 8) Second admin's forced-change flow + password ownership.
    cookie = '';
    r = await req('POST', '/login', { username: 'jsmith', password: PW2 });
    ok(r.status === 200 && r.body.user.must_change_pw === true, 'second admin login forces change');
    r = await req('GET', '/api/facilities');
    ok(r.status === 403, 'second admin blocked from APIs pre-change');
    r = await req('POST', '/api/me/password', { password: PW2b });
    ok(r.status === 200, 'second admin sets own password');
    cookie = '';
    r = await req('POST', '/login', { username: 'jsmith', password: PW2b });
    ok(r.status === 200 && r.body.user.must_change_pw === false, 'second admin re-login with chosen password');

    // 9) Admin reset of another admin → re-flags must_change.
    cookie = '';
    await req('POST', '/login', { username: 'admin', password: PW1 });
    r = await req('POST', '/api/central-users/' + id2 + '/password', { password: 'ResetByAdmin1' });
    ok(r.status === 200, 'admin reset second admin password');
    cookie = '';
    r = await req('POST', '/login', { username: 'jsmith', password: 'ResetByAdmin1' });
    ok(r.status === 200 && r.body.user.must_change_pw === true, 'reset forces change on next sign-in');

    // 10) Delete second admin; then last-admin rail.
    cookie = '';
    await req('POST', '/login', { username: 'admin', password: PW1 });
    r = await req('DELETE', '/api/central-users/' + id2);
    ok(r.status === 200, 'second admin deleted');
    r = await req('GET', '/api/central-users');
    ok(r.body.users.length === 1, 'one admin remains');
    r = await req('DELETE', '/api/central-users/' + meId);
    ok(r.status === 400, 'cannot delete last admin (self) — rail holds');

    console.log(`\n  ${pass} passed, ${fail} failed`);
    code = fail === 0 ? 0 : 1;
  } catch (e) {
    console.log('  ✗ threw:', e && e.message); code = 1;
  } finally {
    try { srv.kill(); } catch (e) {}
    setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(code); }, 200);
  }
})();
