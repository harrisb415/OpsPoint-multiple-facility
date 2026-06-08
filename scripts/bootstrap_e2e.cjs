'use strict';
/* Phase 4 E2E — bootstrap supervisor.
 * Two scenarios, each a temp install with a pending-verify marker:
 *   A) broken new build  → bootstrap health-checks, ROLLS BACK to the backup
 *   B) healthy new build → bootstrap COMMITS (clears marker, no rollback)
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BOOTSTRAP = path.join(__dirname, '..', 'bootstrap.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const goodServer = (marker) => `
const http=require('http');
require('fs').writeFileSync(require('path').join(__dirname,'${marker}'),'1');
http.createServer((rq,rs)=>{ if(rq.url==='/api/health'){rs.end('{"ok":true}');} else rs.end('ok'); })
  .listen(parseInt(process.env.PORT||'0',10),'127.0.0.1');
`;
const BROKEN = `require('fs').writeFileSync(require('path').join(__dirname,'broken-ran.txt'),'1');process.exit(1);`;

function health(port) { return new Promise(res => { const r = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, x => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(name, { port, currentSrc, backupSrc }) {
  const T = path.join(os.tmpdir(), 'bst_' + name + '_' + Date.now());
  const backup = path.join(T, 'data', 'updates', 'backup', 'prev');
  fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(T, 'server.js'), currentSrc);
  fs.writeFileSync(path.join(backup, 'server.js'), backupSrc);
  fs.writeFileSync(path.join(backup, 'BACKUP.json'), JSON.stringify({ from: '1.0.0', to: '2.0.0' }));
  fs.writeFileSync(path.join(T, 'data', 'updates', 'pending-verify.json'), JSON.stringify({ backupPath: backup, from: '1.0.0', to: '2.0.0' }));
  const bs = spawn(process.execPath, [BOOTSTRAP], {
    env: { ...process.env, OPSPOINT_BOOTSTRAP_BASE: T, OPSPOINT_BOOTSTRAP_ENTRY: path.join(T, 'server.js'), OPSPOINT_DATA: path.join(T, 'data'), PORT: String(port), OPSPOINT_VERIFY_TIMEOUT: '8000' },
    stdio: 'ignore',
  });
  let healthy = false;
  for (let i = 0; i < 50; i++) { await sleep(500); healthy = await health(port); if (healthy) break; }
  await sleep(2000); // let bootstrap settle (clear marker / finish rollback) before snapshotting
  const present = new Set(fs.existsSync(T) ? fs.readdirSync(T) : []);
  const res = {
    healthy,
    markerGone: !fs.existsSync(path.join(T, 'data', 'updates', 'pending-verify.json')),
    serverSrc: fs.readFileSync(path.join(T, 'server.js'), 'utf8'),
    has: (f) => present.has(f),
  };
  try { spawn('taskkill', ['/pid', String(bs.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
  await sleep(400);
  try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) {}
  return res;
}

(async () => {
  let code = 1;
  try {
    console.log('Scenario A — broken new build → rollback');
    const a = await run('A', { port: 4733, currentSrc: BROKEN, backupSrc: goodServer('good-ran.txt') });
    ok(a.healthy, 'A: restored build healthy after rollback');
    ok(a.has('broken-ran.txt'), 'A: broken build attempted first');
    ok(a.has('good-ran.txt'), 'A: rolled-back build then ran');
    ok(a.serverSrc.includes('good-ran.txt'), 'A: server.js restored from backup');
    ok(a.markerGone, 'A: pending-verify marker cleared');

    console.log('Scenario B — healthy new build → commit (no rollback)');
    const b = await run('B', { port: 4734, currentSrc: goodServer('current-ran.txt'), backupSrc: goodServer('backup-ran.txt') });
    ok(b.healthy, 'B: new build healthy');
    ok(b.has('current-ran.txt'), 'B: new build ran');
    ok(!b.has('backup-ran.txt'), 'B: backup was NOT restored (no false rollback)');
    ok(b.serverSrc.includes('current-ran.txt'), 'B: server.js left as the new build');
    ok(b.markerGone, 'B: pending-verify marker cleared (committed)');

    console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
    code = (pass === 10 && fail === 0) ? 0 : 1;
  } catch (e) { console.log('  ✗ threw:', e && e.message); code = 1; }
  finally { setTimeout(() => process.exit(code), 200); }
})();
