// The startup check in real processes: server.js, HQ and bootstrap.js stop on
// a bad setting with one sentence and exit code 78, before creating anything;
// a TZ from the settings file reaches the process clock; the CLI reports the
// same. Every process here is a child with its own environment — this one's is
// never changed (a TZ set inside jest is shared by every suite, see
// tests/dates.local.test.js).
'use strict';
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettings } = require('../server/settings');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_settings_'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// This machine's environment minus anything OpsPoint would read as a setting.
function childEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(OPSPOINT|CENTRAL)_/.test(k) || /^(DATABASE_URL|SESSION_SECRET|PORT|PG[A-Z]+|VAPID_[A-Z_]+)$/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, OPSPOINT_CONFIG: 'none', ...extra };
}
const node = (args, env, opts = {}) => spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 60000, ...opts });

test('server.js stops with one sentence and exit code 78, before it creates anything', () => {
  const data = path.join(tmp, 'aws-data');
  const r = node(['server.js'], childEnv({ OPSPOINT_PROFILE: 'aws', OPSPOINT_DATA: data, TZ: 'America/Chicago' }));
  expect(r.status).toBe(78);
  expect(r.stderr).toMatch(/OpsPoint can't start: OPSPOINT_DB_DRIVER=pg needs DATABASE_URL, the facility's Postgres connection string: set it in the ECS task definition\.\n/);
  expect(r.stderr).toMatch(/\n {2}Also: Profile aws needs SESSION_SECRET/);
  expect(fs.existsSync(data)).toBe(false);          // no data folder, no key, no database
});

test('HQ stops the same way, naming its own database', () => {
  const data = path.join(tmp, 'hq-data');
  const r = node(['central/server.js'], childEnv({ OPSPOINT_DB_DRIVER: 'pg', CENTRAL_DATA: data, TZ: 'America/Chicago' }));
  expect(r.status).toBe(78);
  expect(r.stderr).toMatch(/OpsPoint HQ can't start: OPSPOINT_DB_DRIVER=pg needs CENTRAL_DATABASE_URL/);
  expect(fs.existsSync(data)).toBe(false);
});

test('a TZ in the settings file becomes the process clock; the environment still wins', () => {
  const file = path.join(tmp, 'tz.config.json');
  fs.writeFileSync(file, JSON.stringify({ TZ: 'Pacific/Kiritimati' }));
  const probe = "const s=require('./server/settings'); s.get('PORT');" +
    "console.log(JSON.stringify({zone:Intl.DateTimeFormat().resolvedOptions().timeZone, src:s.source('TZ'), hour:new Date(Date.UTC(2026,0,1,0)).getHours()}))";
  const env = childEnv({ OPSPOINT_CONFIG: file });
  delete env.TZ;
  expect(JSON.parse(execFileSync(process.execPath, ['-e', probe], { cwd: ROOT, env, encoding: 'utf8' })))
    .toEqual({ zone: 'Pacific/Kiritimati', src: file, hour: 14 });          // UTC+14
  const withEnv = { ...env, TZ: 'America/Denver' };
  expect(JSON.parse(execFileSync(process.execPath, ['-e', probe], { cwd: ROOT, env: withEnv, encoding: 'utf8' })))
    .toMatchObject({ zone: 'America/Denver', src: 'environment' });
});

test('bootstrap.js does not relaunch a server that refused its settings', () => {
  const base = path.join(tmp, 'boot');
  fs.mkdirSync(base, { recursive: true });
  const count = path.join(base, 'launches.txt');
  const entry = path.join(base, 'fake-server.js');
  fs.writeFileSync(entry, `require('fs').appendFileSync(${JSON.stringify(count)}, 'x'); process.exit(78);`);
  const r = node(['bootstrap.js'], childEnv({ OPSPOINT_BOOTSTRAP_BASE: base, OPSPOINT_BOOTSTRAP_ENTRY: entry, OPSPOINT_DATA: path.join(base, 'data') }));
  expect(r.status).toBe(78);
  expect(fs.readFileSync(count, 'utf8')).toBe('x');                      // launched once, not five times
  expect(r.stdout).toMatch(/a setting needs fixing .* Not relaunching/);
});

test('bootstrap.js follows the port and data folder in the settings file', () => {
  const file = path.join(tmp, 'boot.config.json');
  fs.writeFileSync(file, JSON.stringify({ PORT: 3999, OPSPOINT_DATA: '/srv/opspoint-data', OPSPOINT_HEALTH_PATH: '/api/health' }));
  const read = (extra) => JSON.parse(execFileSync(process.execPath,
    ['-e', "const b=require('./bootstrap'); console.log(JSON.stringify({port:b.PORT,data:b.DATA,health:b.HEALTH_PATH}))"],
    { cwd: ROOT, env: childEnv({ OPSPOINT_CONFIG: file, ...extra }), encoding: 'utf8' }));
  expect(read({})).toEqual({ port: 3999, data: '/srv/opspoint-data', health: '/api/health' });
  expect(read({ PORT: '4001' }).port).toBe(4001);
});

test('`settings --check` exits 78 with the reasons, 0 when OpsPoint would start', () => {
  const bad = node(['server/cli/opspoint.js', 'settings', '--check'], childEnv({ OPSPOINT_PROFILE: 'gcp', TZ: 'America/Chicago' }));
  expect(bad.status).toBe(78);
  expect(bad.stdout).toMatch(/^ERROR {4}Profile gcp needs SESSION_SECRET/m);
  const ok = node(['server/cli/opspoint.js', 'settings', '--check'], childEnv({ TZ: 'America/Chicago' }));
  expect(ok.status).toBe(0);
  expect(ok.stdout).toMatch(/^OK: OpsPoint would start \(profile \S+, time zone America\/Chicago\)\./);
});

test('`settings` lists values with secrets hidden', () => {
  const r = node(['server/cli/opspoint.js', 'settings'], childEnv({
    TZ: 'America/Chicago', OPSPOINT_DB_DRIVER: 'pg', DATABASE_URL: 'postgresql://opspoint:Sup3rSecretPw@db.lan/opspoint', PGSSLMODE: 'require',
  }));
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/DATABASE_URL +\(set, hidden\) +environment/);
  expect(r.stdout).not.toContain('Sup3rSecretPw');
});

test('`keys` makes a session secret and one matching push key pair', () => {
  const k = JSON.parse(execFileSync(process.execPath, ['server/cli/opspoint.js', 'keys', '--json'], { cwd: ROOT, env: childEnv(), encoding: 'utf8' }));
  expect(k.SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/);
  const s = createSettings({
    env: { ...k, OPSPOINT_PROFILE: 'gcp', TZ: 'America/Chicago', DATABASE_URL: 'postgresql://u:p@10.0.0.5/opspoint' },
    processZone: () => 'America/Chicago',
    readFile: () => { const e = new Error('none'); e.code = 'ENOENT'; throw e; },
  });
  expect(s.check().filter((p) => p.level === 'error')).toEqual([]);
});
