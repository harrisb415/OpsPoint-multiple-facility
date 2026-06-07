'use strict';
/* E2E for central/updater.js. Serves a manifest over a local http server (allowed
 * because the configured manifest host is added to the allowlist) and exercises
 * check() + the Ed25519 signature path. check() does not download, so no real
 * bundle is needed. The fixture signature was signed with the real release key
 * over "9.9.9\n12345\n<64 a's>" — same fixture the facility signing test uses. */
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createUpdater } = require('../updater');

const SHA = 'a'.repeat(64);
const FIXTURE_SIG = 'qT44Ua4AtSB9Y6By9+03JZCDlLaSeAij23bETRxAKSMGuWU6KMt6oiH6mgwOW5Zkuj28nFjKuCPdYx5eE4yuDA==';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

let serveBody = '';
const srv = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(serveBody); });

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const url = `http://127.0.0.1:${port}/central-manifest.json`;
  const tmp = path.join(os.tmpdir(), 'cupd_' + Date.now());
  const base = { version: '9.9.9', released: new Date().toISOString(), url: `http://127.0.0.1:${port}/bundle.zip`, sha256: SHA, size: 12345, sig_alg: 'ed25519', signature: FIXTURE_SIG, changelog: ['test build'] };
  const mk = () => createUpdater({
    baseDir: path.join(__dirname, '..'), dataDir: tmp, dbPath: path.join(tmp, 'central.db'),
    getSetting: (k, d) => (k === 'central_update_manifest_url' ? url : d), audit: () => {}, restart: () => {}, log: () => {},
  });
  let code = 1;
  try {
    // Signed, newer version.
    serveBody = JSON.stringify(base);
    let s = await mk().check();
    ok(s.latest === '9.9.9', 'check() reports latest 9.9.9');
    ok(s.available === true, 'update available vs current ' + s.current);
    ok(s.signed === true, 'signed manifest verifies (signed=true)');

    // Unsigned manifest → signed=false (apply() would refuse).
    serveBody = JSON.stringify({ ...base, signature: undefined });
    s = await mk().check();
    ok(s.signed === false, 'unsigned manifest → signed=false');

    // Tampered version (signature no longer matches the payload).
    serveBody = JSON.stringify({ ...base, version: '9.9.10' });
    s = await mk().check();
    ok(s.signed === false, 'tampered version → signed=false');

    // status() shape before any check on a fresh instance.
    const st = mk().status();
    ok(st.current && st.progress && st.progress.phase === 'idle', 'status() returns current + idle progress');

    console.log(`\n  ${pass} passed, ${fail} failed`);
    code = fail === 0 ? 0 : 1;
  } catch (e) {
    console.log('  ✗ threw:', e && e.message); code = 1;
  } finally {
    srv.close();
    setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} process.exit(code); }, 150);
  }
})();
