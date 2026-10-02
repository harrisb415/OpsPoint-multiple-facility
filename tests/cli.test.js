// The command line as a person at a terminal meets it: the export passphrase question stays
// on the screen while what is typed never shows (readline clears its line as it starts
// reading, which once wiped the question away on Windows and Linux alike), and `backups`
// names the folder backups really go to. Every install here is a throwaway in a temporary
// folder.
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { BY_NAME } = require('../server/settings/schema');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'server', 'cli', 'opspoint.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_cli_'));
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* temp */ } });

// A new install in its own folder: none of this process's settings.
function installEnv(dir, extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!BY_NAME[k] && !BY_NAME[k.replace(/_FILE$/, '')]) env[k] = v;
  return {
    ...env, OPSPOINT_CONFIG: 'none', OPSPOINT_DB_DRIVER: 'sqlite', OPSPOINT_DATA: dir, OPSPOINT_DB: path.join(dir, 'x.db'),
    OPSPOINT_UPDATES: 'platform', TZ: 'America/Chicago', ...extra,
  };
}
const cli = (args, env) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 60000 });
function initDb(env) {
  const r = spawnSync(process.execPath, ['-e', [
    `const db = require(${JSON.stringify(path.join(ROOT, 'db'))});`,
    `db.init(require(${JSON.stringify(path.join(ROOT, 'server', 'config'))}).DB_PATH).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });`,
  ].join(' ')], { env, encoding: 'utf8' });
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
}
function setSetting(env, key, value) {
  const r = spawnSync(process.execPath, ['-e', [
    `const c = require(${JSON.stringify(path.join(ROOT, 'server', 'db', 'connection'))});`,
    `c.open(require(${JSON.stringify(path.join(ROOT, 'server', 'config'))}).DB_PATH);`,
    `Promise.resolve(c.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))}]))`,
    '.then(() => c.close()).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });',
  ].join(' ')], { env, encoding: 'utf8' });
  expect(r.status).toBe(0);
}

describe('the export passphrase, typed at a terminal', () => {
  // A terminal of its own (util-linux script); `keys` are typed once the question shows.
  const hasScript = process.platform === 'linux' && spawnSync('script', ['--version'], { encoding: 'utf8' }).status === 0;
  const onTerminal = (args, env, keys) => new Promise((resolve) => {
    const line = [process.execPath, CLI, ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const p = spawn('script', ['-qefc', line, '/dev/null'], { env });
    let out = '', typed = false;
    p.stdout.on('data', (d) => {
      out += d;
      if (!typed && out.includes('Export passphrase: ')) { typed = true; setTimeout(() => p.stdin.write(keys), 200); }
    });
    const stop = setTimeout(() => p.kill(), 30000);
    p.on('exit', (code) => { clearTimeout(stop); resolve({ code, out }); });
  });
  const notAnExport = () => {
    const f = path.join(TMP, 'not-an-export.opspoint');
    fs.writeFileSync(f, 'not an export');
    return f;
  };

  (hasScript ? test : test.skip)('the question stays on the screen, and what is typed never shows', async () => {
    const r = await onTerminal(['import', notAnExport()], installEnv(path.join(TMP, 'tty')), 'typed-at-the-terminal\r');
    const after = r.out.slice(r.out.indexOf('Export passphrase: ') + 'Export passphrase: '.length);
    expect(after.split('\n')[0]).not.toMatch(/\x1b/);                  // nothing moves the cursor back over it
    expect(r.out).not.toMatch(/typed-at-the-terminal/);
    expect(r.out).toMatch(/isn't an OpsPoint export/);                 // the typed passphrase was the one used
    expect(r.code).toBe(1);
  });

  (hasScript ? test : test.skip)('Ctrl+C stops the command instead of answering with nothing', async () => {
    const r = await onTerminal(['import', notAnExport()], installEnv(path.join(TMP, 'tty2')), 'abc\x03');
    expect(r.code).toBe(130);
    expect(r.out).not.toMatch(/No passphrase/);
  });
});

describe('backups', () => {
  const dir = path.join(TMP, 'install');
  const env = installEnv(dir);
  const scheduled = path.join(dir, 'backups', 'scheduled');

  test('before the first backup, it names the folder they will go to', () => {
    initDb(env);
    const r = cli(['backups'], env);
    expect(r.stdout).toBe(`No database backups in ${scheduled} yet.\n`);
    expect(r.status).toBe(0);
  });

  test('lists the newest first, with their size and time', () => {
    fs.mkdirSync(scheduled, { recursive: true });
    const older = path.join(scheduled, 'opspoint-2026-09-30_180000.db'), newer = path.join(scheduled, 'opspoint-2026-10-01_000000.db');
    fs.writeFileSync(older, Buffer.alloc(300 * 1024));
    fs.writeFileSync(newer, Buffer.alloc(100));
    fs.writeFileSync(path.join(scheduled, 'notes.txt'), 'not a backup');
    fs.utimesSync(older, new Date('2026-09-30T18:00:00Z'), new Date('2026-09-30T18:00:00Z'));
    fs.utimesSync(newer, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
    const r = cli(['backups'], env);
    expect(r.status).toBe(0);
    const lines = r.stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(`Database backups in ${scheduled}, newest first:`);
    expect(lines.slice(1)).toEqual([
      expect.stringMatching(/^  opspoint-2026-10-01_000000\.db +0\.0 MB +\w+ \d+, 2026/),
      expect.stringMatching(/^  opspoint-2026-09-30_180000\.db +0\.3 MB +\w+ \d+, 2026/),
    ]);
  });

  test('a backup folder chosen in setup (backup_dir) is the one it lists', () => {
    const elsewhere = path.join(TMP, 'other-drive', 'opspoint-backups');
    setSetting(env, 'backup_dir', elsewhere);
    expect(cli(['backups'], env).stdout).toBe(`No database backups in ${elsewhere} yet.\n`);
  });

  test("on a managed platform it says the platform keeps them", () => {
    const r = cli(['backups'], { ...env, OPSPOINT_BACKUPS: 'provider' });
    expect(r.stdout).toMatch(/point-in-time restore \(OPSPOINT_BACKUPS=provider\)/);
    expect(r.status).toBe(0);
  });
});
