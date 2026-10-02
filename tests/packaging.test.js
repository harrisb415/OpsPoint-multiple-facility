// Packages (roadmap phase 8): the installers' shared look stays generated from
// packaging/brand.json, the Linux installer parses and plans an install without
// changing anything (--dry-run), and its unattended answers file is read as
// data. Nothing here installs anything; the bash parts skip where there is no bash.
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INSTALL_SH = path.join(ROOT, 'packaging', 'linux', 'install.sh');
const gen = require('../scripts/gen-brand.cjs');

// Git Bash on Windows, bash elsewhere; null when there is none.
function findBash() {
  const cands = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']
    : ['/bin/bash', '/usr/bin/bash'];
  return cands.find((p) => fs.existsSync(p)) || null;
}
const BASH = findBash();
const withBash = BASH ? test : test.skip;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'opspoint_pkg_'));
afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* temp */ } });

// Run the installer with a clean environment: no colour, not a terminal, and none of its answers
// (TZ, DATABASE_URL, PGSSLMODE…): it takes one already set in the environment as given, and the
// Postgres audit runs the tests with several set.
const ANSWER_KEYS = /case "\$k" in ([A-Z_|]+)\)/.exec(fs.readFileSync(INSTALL_SH, 'utf8'))[1].split('|');
function sh(args, extraEnv = {}) {
  const env = { ...process.env };
  for (const k of ANSWER_KEYS) delete env[k];
  return spawnSync(BASH, [INSTALL_SH, ...args], {
    encoding: 'utf8', timeout: 60000,
    // Git Bash would rewrite /paths in the environment into C:/Program Files/Git/...
    env: { ...env, NO_COLOR: '1', MSYS2_ENV_CONV_EXCL: '*', MSYS_NO_PATHCONV: '1', ...extraEnv },
  });
}

describe('the installers look the same', () => {
  test('the brand blocks are generated from packaging/brand.json', () => {
    expect(gen.apply(true)).toEqual([]);
    const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'packaging', 'brand.json'), 'utf8'));
    expect(brand.palette.navy.hex).toBe('#1E3A70');
    expect(brand.palette.gold.hex).toBe('#F5B82E');
    // Pass and fail stay green and red: a failed check never looks like a brand colour.
    expect(brand.palette.pass.ansi16).toBe('green');
    expect(brand.palette.fail.ansi16).toBe('red');
    expect(brand.menu.items.map((i) => i.label)).toEqual(
      ['Install OpsPoint', 'Upgrade or repair', 'Health check', 'Back up or restore', 'Export or import', 'Uninstall', 'Quit']);
    // Every menu item has its own key: menus never need arrows or a mouse.
    const keys = brand.menu.items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('both maintenance tools pass on the same commands the command line has', () => {
    const js = fs.readFileSync(path.join(ROOT, 'server', 'cli', 'opspoint.js'), 'utf8');
    const handled = [...js.matchAll(/if \(cmd === '([\w-]+)'\)/g)].map((m) => m[1]).sort();
    const linux = /^CLI_COMMANDS=" ([^"]+) "$/m.exec(fs.readFileSync(INSTALL_SH, 'utf8'))[1].split(' ').sort();
    const windows = /^\$CliCommands = @\(([^)]*)\)/m.exec(fs.readFileSync(path.join(ROOT, 'packaging', 'windows', 'opspoint.ps1'), 'utf8'))[1]
      .split(',').map((s) => s.trim().replace(/'/g, '')).sort();
    expect(handled).toContain('backups');
    expect(linux).toEqual(handled);
    expect(windows).toEqual(handled);
  });

  test('the installer pins the release key the updater pins', () => {
    const sh = fs.readFileSync(INSTALL_SH, 'utf8');
    const updater = fs.readFileSync(path.join(ROOT, 'updater.js'), 'utf8');
    const key = /PUBKEY="([^"]+)"/.exec(sh)[1];
    expect(updater).toContain(key);
  });
});

describe('the release bundle and the in-app updater', () => {
  test('the bundle carries every file and folder an update swaps, and the icons', () => {
    const rel = fs.readFileSync(path.join(ROOT, 'scripts', 'release.mjs'), 'utf8');
    const list = (re) => JSON.parse(re.exec(rel)[1].replace(/path\.join\('client', 'dist'\)/g, '"client/dist"').replace(/'/g, '"'));
    const files = list(/^const FILES = (\[[^\]]*\]);/m), dirs = list(/^const DIRS = (\[[^\]]*\]);/m);
    const up = fs.readFileSync(path.join(ROOT, 'updater.js'), 'utf8');
    const uFiles = JSON.parse(/^const RUNTIME_FILES = (\[[^\]]*\]);/m.exec(up)[1].replace(/'/g, '"'));
    const uDirs = JSON.parse(/^const RUNTIME_DIRS = (\[[^\]]*\]);/m.exec(up)[1].replace(/path\.join\('client', 'dist'\)/g, '"client/dist"').replace(/'/g, '"'));
    for (const f of uFiles) expect(files).toContain(f);
    for (const d of uDirs) expect(dirs).toContain(d);
    expect(dirs).toContain('static');                 // favicon + phone app icons for installs made from the bundle
    expect(files).toContain('packaging/linux/install.sh');   // the maintenance tool, inside the signed bundle
  });
});

describe('the Windows installer', () => {
  const PS1 = path.join(ROOT, 'packaging', 'windows', 'opspoint.ps1');
  const ISS = path.join(ROOT, 'packaging', 'windows', 'opspoint.iss');

  test('its pictures are made from the icon, and in date', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-installer-art.cjs'), '--check'], { encoding: 'utf8' });
    expect(r.stdout).toMatch(/up to date/);
    expect(r.status).toBe(0);
  });

  test('the Setup script names every file it installs, and keeps the data on uninstall', () => {
    const iss = fs.readFileSync(ISS, 'utf8');
    for (const f of ['art\\wizard.bmp', 'art\\header.bmp', 'art\\opspoint.ico', 'opspoint.ps1', 'opspoint.cmd']) {
      expect(fs.existsSync(path.join(ROOT, 'packaging', 'windows', f.replace('\\', path.sep)))).toBe(true);
    }
    expect(iss).toMatch(/\[UninstallRun\][\s\S]*-RemoveService/);
    expect(iss).toMatch(/networkservice-modify/);
    expect(iss).not.toMatch(/commonappdata\}\\OpsPoint"; Type: filesandordirs/);     // the data folder stays
    expect(iss).toMatch(/\[UninstallDelete\][\s\S]*opspoint\.config\.json/);       // ...the settings (and any password) don't
  });

  test('Setup knows whether the questions got OpsPoint running, and stops it before replacing it', () => {
    const iss = fs.readFileSync(ISS, 'utf8');
    // -Configure runs from [Code], where its exit code is read (a [Run] entry's is ignored).
    expect(iss).not.toMatch(/^\[Run\]/m);
    expect(iss).toMatch(/procedure CurStepChanged[\s\S]*ssPostInstall[\s\S]*-Configure ' \+ ConfigureArgs/);
    expect(iss).toMatch(/function GetCustomSetupExitCode[\s\S]*Result := 10/);
    // Run again over an install: its node.exe is in use until OpsPoint stops.
    expect(iss).toMatch(/function PrepareToInstall[\s\S]*-StopService/);
  });

  test('no function in the maintenance tool has the name of a built-in alias (an alias wins)', () => {
    // Get-Alias on Windows 11's Windows PowerShell 5.1 (a clean VM, 2026-10-01). `cli` is
    // Clear-Item: a function named Cli never ran, and doctor, export and import with it.
    const ALIASES = ('% ? ac asnp cat cd CFS chdir clc clear clhy cli clp cls clv cnsn compare copy cp cpi cpp curl cvpa dbp ' +
      'del diff dir dnsn ebp echo epal epcsv epsn erase etsn exsn fc fhx fl foreach ft fw gal gbp gc gci gcm gcs gdr ghy gi ' +
      'gjb gl gm gmo gp gps gpv group gsn gsnp gsv gu gv gwmi h history icm iex ihy ii ipal ipcsv ipmo ipsn irm ise iwmi iwr ' +
      'kill lp ls man md measure mi mount move mp mv nal ndr ni nmo npssc nsn nv ogv oh popd ps pushd pwd r rbp rcjb rcsn rd ' +
      'rdr ren ri rjb rm rmdir rmo rni rnp rp rsn rsnp rujb rv rvpa rwmi sajb sal saps sasv sbp sc select set shcm si sl ' +
      'sleep sls sort sp spjb spps spsv start sujb sv swmi tee trcm type wget where wjb write').toLowerCase().split(' ');
    const ps1 = fs.readFileSync(PS1, 'utf8');
    const names = [...ps1.matchAll(/^\s*function\s+([\w-]+)/gim)].map((m) => m[1].toLowerCase());
    expect(names.length).toBeGreaterThan(20);
    expect(names.filter((n) => ALIASES.includes(n))).toEqual([]);
  });

  test('a Start menu click (not an administrator) gets the menu as one; nothing opens the data folder in Explorer', () => {
    const ps1 = fs.readFileSync(PS1, 'utf8');
    expect(ps1).toMatch(/if \(-not \(IsAdmin\) -and -not \$DryRun\) \{[\s\S]*?-Verb RunAs/);
    // Explorer runs without administrator rights, and the data folder is closed to everyone else.
    expect(ps1).not.toMatch(/explorer\.exe[^\r\n]*\$data/i);
    // The door's glyphs follow the console's own window (conhost or a pseudo-console): a console
    // Setup starts from Windows Terminal inherits WT_SESSION and still can't draw ◖ ◗.
    expect(ps1).toMatch(/\$FullGlyphs = \$cls\.ToString\(\) -eq 'PseudoConsoleWindow'/);
    expect(ps1).not.toMatch(/if \([^)]*\$env:WT_SESSION/);
  });

  test('the maintenance tool is UTF-8 with a BOM, so Windows PowerShell 5.1 reads its glyphs', () => {
    expect(fs.readFileSync(PS1).subarray(0, 3).toString('hex')).toBe('efbbbf');
  });

  (process.platform === 'win32' ? test : test.skip)('it parses, and plans an unattended install without changing anything', () => {
    const parse = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${PS1}',[ref]$t,[ref]$e);if($e){$e|%{$_.Message};exit 1}`], { encoding: 'utf8' });
    expect(parse.stdout.trim()).toBe('');
    expect(parse.status).toBe(0);
    const dir = fs.mkdtempSync(path.join(TMP, 'win-'));
    const answers = path.join(dir, 'answers.env');
    fs.writeFileSync(answers, 'TZ=America/Denver\r\nPORT=3080\r\nOPSPOINT_DB_DRIVER=pg\r\nDATABASE_URL="postgresql://ops:Sup3r-secret@db.internal:5432/opspoint"\r\nADDRESS=ops.example.org\r\n');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1,
      '-Configure', '-DryRun', '-Yes', '-Config', answers, '-InstallDir', dir], { encoding: 'utf8', timeout: 120000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Checking this machine/);
    expect(r.stdout).toMatch(/"TZ":\s+"America\/Denver"/);
    expect(r.stdout).toMatch(/"DATABASE_URL":\s+"postgresql:\/\/ops:•••@db\.internal:5432\/opspoint"/);
    expect(r.stdout).toMatch(/"PGSSLMODE":\s+"verify-full"/);                 // another machine: verified TLS
    expect(r.stdout).not.toMatch(/Sup3r-secret/);
    expect(r.stdout).toMatch(/would register the scheduled task OpsPoint/);
    expect(r.stdout).toMatch(/http:\/\/ops\.example\.org:3080\/setup/);
    expect(fs.existsSync(path.join(dir, 'app', 'opspoint.config.json'))).toBe(false);
  });
});

describe('the Docker image and the pipeline', () => {
  test('only what the app needs goes into an image build: never data, keys or settings', () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8').split(/\r?\n/);
    expect(ignore[ignore.findIndex((l) => l && !l.startsWith('#'))]).toBe('*');       // an allowlist
    for (const l of ['!data/', '!release/', '!.env', '!release-private.pem']) expect(ignore).not.toContain(l);
    const df = fs.readFileSync(path.join(ROOT, 'packaging', 'docker', 'Dockerfile'), 'utf8');
    expect(df).toMatch(/^USER node$/m);
    expect(df).toMatch(/OPSPOINT_PROFILE=docker/);
    expect(df).toMatch(/HEALTHCHECK[\s\S]*\/healthz/);
    expect(df).not.toMatch(/COPY \. /);
    // The SQLite driver's prebuilt binary, as in the installers: npm's implicit node-gyp rebuild needs build tools.
    expect(df).toMatch(/npm ci --omit=dev --ignore-scripts/);
  });

  test('the workflows run only by hand, and publish only when asked, with the key from a secret', () => {
    const yaml = require('js-yaml');
    const ci = yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
    const rel = yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8'));
    expect(Object.keys(ci.on)).toEqual(['workflow_dispatch']);
    expect(Object.keys(rel.on)).toEqual(['workflow_dispatch']);
    expect(Object.keys(ci.jobs).sort()).toEqual(['postgres', 'sqlite', 'storage']);
    expect(Object.keys(rel.jobs).sort()).toEqual(['bundle', 'cloud', 'docker', 'publish', 'windows']);
    expect(rel.jobs.publish.needs.sort()).toEqual(['bundle', 'cloud', 'docker', 'windows']);
    expect(rel.jobs.publish.if).toMatch(/inputs\.publish/);
    const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(text).toMatch(/OPSPOINT_RELEASE_KEY: \$\{\{ secrets\.OPSPOINT_RELEASE_KEY \}\}/);
    expect(text).not.toMatch(/BEGIN (EC |)PRIVATE KEY/);
  });
});

describe('the Linux installer', () => {
  withBash('parses, and --help says how to use it', () => {
    expect(spawnSync(BASH, ['-n', INSTALL_SH], { encoding: 'utf8' }).status).toBe(0);
    const r = sh(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/--config FILE/);
    expect(r.stdout).toMatch(/--dry-run/);
    expect(r.stdout).not.toMatch(/^=+$/m);
  });

  withBash('plans an unattended install from an answers file, changing nothing and showing no password', () => {
    const answers = path.join(TMP, 'answers.env');
    fs.writeFileSync(answers, [
      '# OpsPoint answers', 'TZ=America/Denver', 'PORT=8080', 'OPSPOINT_DATA=/srv/ops-data',
      'OPSPOINT_DB_DRIVER=pg', 'DATABASE_URL="postgresql://ops:Sup3r-secret@db.internal:5432/opspoint"',
      'SERVICE=systemd', "ADDRESS='ops.example.org'", '',
    ].join('\n'));
    const r = sh(['--dry-run', '--yes', '--config', answers, '--prefix', '/opt/opspoint-test', 'install']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const out = r.stdout;
    expect(out).toMatch(/Checking this machine/);
    expect(out).toMatch(/Database: Postgres at db\.internal:5432/);
    expect(out).toMatch(/would write \/etc\/opspoint\/opspoint\.config\.json \(0640, root:opspoint\)/);
    expect(out).toMatch(/"TZ": "America\/Denver"/);
    expect(out).toMatch(/"PORT": 8080/);
    expect(out).toMatch(/"OPSPOINT_DATA": "\/srv\/ops-data"/);
    expect(out).toMatch(/"DATABASE_URL": "postgresql:\/\/ops:•••@db\.internal:5432\/opspoint"/);
    expect(out).toMatch(/"PGSSLMODE": "verify-full"/);                       // another machine: verified TLS
    expect(out).not.toMatch(/Sup3r-secret/);
    expect(out).toMatch(/WorkingDirectory=\/opt\/opspoint-test\/app/);
    expect(out).toMatch(/RestartPreventExitStatus=78/);
    expect(out).toMatch(/User=opspoint/);
    expect(out).not.toMatch(/AmbientCapabilities/);                         // 8080 needs no privilege
    expect(out).toMatch(/http:\/\/ops\.example\.org:8080\/setup/);
    expect(out).toMatch(/would run: systemctl enable --now opspoint/);
    expect(out).toMatch(/would install the maintenance tool as \/usr\/local\/bin\/opspoint/);
    expect(out).toMatch(/would wait for http:\/\/127\.0\.0\.1:8080\/healthz/);
    // Plain text: no escape codes when NO_COLOR is set or nobody is watching.
    expect(out).not.toMatch(/\u001b\[/);
  });

  test("unpacks a bundle with permissions of its own, never the archive's, into a folder of its own", () => {
    const sh = fs.readFileSync(INSTALL_SH, 'utf8');
    // A bundle packed on Windows (bsdtar) records every folder as 777 and every file as 666, and
    // tar run as root keeps what the archive says: the app it runs would be writable by anyone.
    // (Root-only behaviour, so this reads the rule rather than running it.)
    expect(sh).toMatch(/\(umask 022 && mkdir -p "\$1" && tar -xzf "\$REL_BUNDLE" -C "\$1" --no-same-owner --no-same-permissions\)/);
    expect(sh.match(/tar -xzf "\$REL_BUNDLE"/g)).toHaveLength(1);                  // every unpack goes through it
    // An upgrade or repair unpacks into an empty folder: no file of the version before stays behind.
    expect(sh).toMatch(/run mv "\$APP" "\$PREFIX\/app\.previous"[\s\S]{0,200}unpack "\$APP"/);
  });

  withBash('reads the answers file as data: anything but known KEY=value lines is refused', () => {
    const evil = path.join(TMP, 'evil.env');
    fs.writeFileSync(evil, 'TZ=$(touch /tmp/opspoint-pwned)\nPORT=3000\n');
    const r = sh(['--dry-run', '--yes', '--config', evil, 'install']);
    // The value is taken literally (and then isn't a time zone OpsPoint could use, which the
    // server's own startup check would say); nothing in it ran.
    expect(r.stdout).toMatch(/"TZ": "\$\(touch \/tmp\/opspoint-pwned\)"/);
    const unknown = path.join(TMP, 'unknown.env');
    fs.writeFileSync(unknown, 'SESSION_SECRET=abc\n');
    const u = sh(['--dry-run', '--yes', '--config', unknown, 'install']);
    expect(u.status).not.toBe(0);
    expect(u.stderr).toMatch(/SESSION_SECRET isn't an answer this installer takes/);
    const notkv = path.join(TMP, 'notkv.env');
    fs.writeFileSync(notkv, 'rm -rf /\n');
    const n = sh(['--dry-run', '--yes', '--config', notkv, 'install']);
    expect(n.status).not.toBe(0);
    expect(n.stderr).toMatch(/Not a KEY=value line/);
  });

  withBash('a port below 1024 gets the one capability it needs, and bad answers stop it', () => {
    const a = path.join(TMP, 'low.env');
    fs.writeFileSync(a, 'TZ=UTC\nPORT=443\nOPSPOINT_DATA=/var/lib/opspoint\nSERVICE=systemd\n');
    const r = sh(['--dry-run', '--yes', '--config', a, 'install']);
    expect(r.stdout).toMatch(/AmbientCapabilities=CAP_NET_BIND_SERVICE/);
    expect(r.stdout).toMatch(/http:\/\/[^\s]+:443\/setup/);                 // no certificate yet: plain HTTP on 443
    fs.writeFileSync(a, 'TZ=UTC\nPORT=443\nSERVICE=pm2\n');
    expect(sh(['--dry-run', '--yes', '--config', a, 'install']).stderr).toMatch(/Under pm2 OpsPoint can't take port 443/);
    fs.writeFileSync(a, 'TZ=UTC\nPORT=70000\n');
    expect(sh(['--dry-run', '--yes', '--config', a, 'install']).stderr).toMatch(/PORT must be a number from 1 to 65535/);
    fs.writeFileSync(a, 'TZ=UTC\nOPSPOINT_DATA=relative/path\n');
    expect(sh(['--dry-run', '--yes', '--config', a, 'install']).stderr).toMatch(/must be a full path/);
    fs.writeFileSync(a, 'TZ=UTC\nOPSPOINT_DB_DRIVER=pg\nDATABASE_URL=mysql://x\n');
    expect(sh(['--dry-run', '--yes', '--config', a, 'install']).stderr).toMatch(/DATABASE_URL must be a postgresql:\/\/ connection string/);
    // A database on this machine needs no TLS; anything else may not be named.
    fs.writeFileSync(a, 'TZ=UTC\nSERVICE=systemd\nOPSPOINT_DB_DRIVER=pg\nDATABASE_URL=postgresql://ops:pw@127.0.0.1:5432/opspoint\n');
    expect(sh(['--dry-run', '--yes', '--config', a, 'install']).stdout).toMatch(/"PGSSLMODE": "disable"/);
    fs.writeFileSync(a, 'TZ=UTC\nOPSPOINT_DB_DRIVER=pg\nDATABASE_URL=postgresql://ops:pw@db/opspoint\nPGSSLMODE=maybe\n');
    expect(sh(['--dry-run', '--yes', '--config', a, 'install']).stderr).toMatch(/PGSSLMODE must be verify-full, verify-ca, require or disable/);
  });
});
