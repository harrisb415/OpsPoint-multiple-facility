/**
 * smoke.mjs — Phase 0 end-to-end check against a running central server.
 *
 *   1. admin login            (session cookie)
 *   2. create a facility      (receive one-time API key)
 *   3. node check-in          (X-Facility-Key header)
 *   4. list facilities        (assert last_seen recorded + version)
 *
 * Run the server first with a known admin password, e.g.:
 *   CENTRAL_ADMIN_PW=smoke-admin-pw  PORT=4000  node server.js
 *   CENTRAL_ADMIN_PW=smoke-admin-pw  node scripts/smoke.mjs
 */
const BASE     = process.env.BASE || 'http://localhost:4000';
const ADMIN_PW = process.env.CENTRAL_ADMIN_PW || 'smoke-admin-pw';

let cookie = '';
async function jf(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    // connection:close keeps undici from holding keep-alive sockets open, so the
    // script's event loop drains cleanly instead of needing a hard process.exit.
    headers: { 'content-type': 'application/json', connection: 'close', origin: BASE, ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const sc = (r.headers.getSetCookie ? r.headers.getSetCookie() : []) || [];
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
  let body = null; try { body = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body };
}

async function waitForServer(tries = 20) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(BASE + '/api/me', { headers: { connection: 'close' } }); if (r.status) return true; }
    catch (e) { await new Promise(res => setTimeout(res, 250)); }
  }
  return false;
}

// Delay the exit briefly so any handle mid-close finishes before the process
// tears down (avoids a libuv UV_HANDLE_CLOSING assert on Windows).
function done(code) { setTimeout(() => process.exit(code), 100); }
function assert(cond, msg) { if (!cond) { console.error('  ✗ FAIL:', msg); done(1); throw new Error(msg); } console.log('  ✓', msg); }

(async () => {
  console.log('Smoke test →', BASE);
  if (!(await waitForServer())) { console.error('  ✗ server not reachable at', BASE); return done(1); }

  let r = await jf('/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: ADMIN_PW }) });
  assert(r.ok, `admin login (status ${r.status})`);

  const name = 'Smoke House ' + Date.now();
  r = await jf('/api/facilities', { method: 'POST', body: JSON.stringify({ name }) });
  assert(r.ok && r.body.apiKey, 'create facility + receive one-time key');
  const facId = r.body.facility.id, apiKey = r.body.apiKey;

  // Wrong key must be rejected.
  r = await jf('/enroll/checkin', { method: 'POST', headers: { 'x-facility-key': 'deadbeef' }, body: '{}' });
  assert(r.status === 401, 'bad facility key rejected (401)');

  // Real check-in.
  r = await jf('/enroll/checkin', { method: 'POST', headers: { 'x-facility-key': apiKey }, body: JSON.stringify({ app_version: '2.3.3' }) });
  assert(r.ok && r.body.facility.id === facId, 'node check-in accepted');

  // Verify it shows up with last_seen + version.
  r = await jf('/api/facilities', { method: 'GET' });
  const fac = (r.body.facilities || []).find(f => f.id === facId);
  assert(fac && fac.last_seen_at, 'facility shows last_seen_at after check-in');
  assert(fac && fac.app_version === '2.3.3', 'reported app_version recorded');

  console.log('\n  ALL PASS ✓\n');
  done(0);
})();
