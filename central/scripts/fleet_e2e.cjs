'use strict';
/* Phase 3 E2E — HQ release store + fleet relay.
 * A local "origin" server stands in for GitHub. HQ imports a SIGNED release from
 * it (verifying signature + sha256), then serves the bundle to a facility over the
 * API-key channel. Signs in-test with release-private.pem (present on the dev box). */
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = 4599;
const DATA = path.join(__dirname, '..', 'data_fleettest');
const PW0 = 'FleetAdminPw0';
const KEYPEM = fs.readFileSync(path.join(__dirname, '..', '..', 'release-private.pem'), 'utf8');

const BUNDLE = Buffer.from('PK fake opspoint bundle '.repeat(40));
const SHA = crypto.createHash('sha256').update(BUNDLE).digest('hex');
const SIZE = BUNDLE.length;
const VER = '2.3.9';
const sign = (ver, size, sha) => crypto.sign(null, Buffer.from(`${ver}\n${size}\n${sha}`, 'utf8'), crypto.createPrivateKey(KEYPEM)).toString('base64');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

let cookie = '';
function req(method, p, body, extra) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { connection: 'close', ...(extra || {}) };
    if (cookie) headers.cookie = cookie;
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    if (method !== 'GET') headers.origin = 'http://127.0.0.1:' + PORT;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, res => {
      const sc = res.headers['set-cookie']; if (sc && sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => { const buf = Buffer.concat(chunks); let j = null; try { j = JSON.parse(buf.toString()); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: buf }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitReady() { for (let i = 0; i < 60; i++) { try { const r = await req('GET', '/api/me'); if (r.status === 401 || r.status === 200) return true; } catch (e) {} await sleep(150); } return false; }

(async () => {
  fs.rmSync(DATA, { recursive: true, force: true });
  let manifestBody = '';
  const origin = http.createServer((rq, rs) => {
    if (rq.url.startsWith('/m')) { rs.setHeader('content-type', 'application/json'); rs.end(manifestBody); }
    else if (rq.url.startsWith('/b')) { rs.setHeader('content-type', 'application/zip'); rs.end(BUNDLE); }
    else { rs.statusCode = 404; rs.end(); }
  });
  await new Promise(r => origin.listen(0, '127.0.0.1', r));
  const oport = origin.address().port;
  const manifestUrl = `http://127.0.0.1:${oport}/m.json`;
  const bundleUrl = `http://127.0.0.1:${oport}/b.zip`;

  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), CENTRAL_DATA: DATA, CENTRAL_ADMIN_PW: PW0 }, stdio: 'ignore',
  });
  let code = 1;
  try {
    ok(await waitReady(), 'central booted');
    let r = await req('POST', '/login', { username: 'admin', password: PW0 }); ok(r.status === 200, 'admin login');
    await req('POST', '/api/me/password', { password: 'FleetAdminPw1' }); // clear must_change
    r = await req('POST', '/api/facilities', { name: 'Relay House' }); ok(r.status === 200 && r.body.apiKey, 'facility enrolled');
    const key = r.body.apiKey;

    // Unsigned manifest → refused.
    manifestBody = JSON.stringify({ version: VER, url: bundleUrl, sha256: SHA, size: SIZE });
    r = await req('POST', '/api/releases/import', { manifest_url: manifestUrl, channel: 'facility' });
    ok(r.status === 400, 'unsigned manifest import refused (400)');

    // Signed manifest → imported.
    manifestBody = JSON.stringify({ version: VER, released: new Date().toISOString(), url: bundleUrl, sha256: SHA, size: SIZE, sig_alg: 'ed25519', signature: sign(VER, SIZE, SHA), changelog: ['fleet test'] });
    r = await req('POST', '/api/releases/import', { manifest_url: manifestUrl, channel: 'facility' });
    ok(r.status === 200 && r.body.release && r.body.release.version === VER, 'signed release imported');

    r = await req('GET', '/api/releases');
    ok(r.status === 200 && (r.body.releases || []).some(x => x.version === VER && x.channel === 'facility'), 'release listed in store');

    // Fleet manifest (facility key): url rewritten to HQ, signature relayed.
    r = await req('GET', '/fleet/manifest', null, { 'x-facility-key': key });
    ok(r.status === 200 && r.body.version === VER, 'fleet manifest served to facility');
    ok(/\/fleet\/bundle\//.test(r.body.url || ''), 'fleet manifest url points back at HQ');
    ok(r.body.signature === sign(VER, SIZE, SHA), 'fleet manifest carries the vendor signature');
    ok((r.body.sha256 || '').toLowerCase() === SHA, 'fleet manifest sha256 matches');

    // Fleet bundle (facility key): exact bytes.
    r = await req('GET', '/fleet/bundle/' + VER, null, { 'x-facility-key': key });
    ok(r.status === 200 && r.raw.length === SIZE, 'fleet bundle streamed (' + r.raw.length + ' bytes)');
    ok(crypto.createHash('sha256').update(r.raw).digest('hex') === SHA, 'fleet bundle sha256 matches');

    // No key → rejected.
    r = await req('GET', '/fleet/bundle/' + VER);
    ok(r.status === 401, 'fleet bundle without API key rejected (401)');

    // Yank → no longer served.
    await req('POST', '/api/releases/facility/' + VER + '/status', { status: 'yanked' });
    r = await req('GET', '/fleet/manifest', null, { 'x-facility-key': key });
    ok(r.status === 404, 'yanked release no longer served to fleet');

    console.log(`\n  ${pass} passed, ${fail} failed`);
    code = fail === 0 ? 0 : 1;
  } catch (e) { console.log('  ✗ threw:', e && e.message); code = 1; }
  finally { try { srv.kill(); } catch (e) {} origin.close(); setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {} process.exit(code); }, 250); }
})();
