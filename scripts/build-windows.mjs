#!/usr/bin/env node
/**
 * Stage what OpsPoint Setup for Windows installs (deployment plan phase 8),
 * after scripts/release.mjs has built release/opspoint-<ver>/:
 *
 *   release/windows/app    that bundle, with its packages for Windows x64 (npm ci --omit=dev)
 *   release/windows/node   Node.js <NODE_VERSION> for Windows x64, checked against
 *                          nodejs.org's SHASUMS256.txt before it is unpacked
 *
 * then compile:  ISCC /DAppVersion=<ver> packaging\windows\opspoint.iss
 * Run on Windows (the packages include a native module built for it).
 *
 *   node scripts/build-windows.mjs [--skip-node]
 * NODE_VERSION is the Linux installer's (packaging/linux/install.sh), so both
 * installers ship the same Node.
 */
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const NODE_VERSION = /^NODE_VERSION="([0-9.]+)"/m.exec(fs.readFileSync(path.join(ROOT, 'packaging', 'linux', 'install.sh'), 'utf8'))[1];
const REL = path.join(ROOT, 'release');
const BUNDLE = path.join(REL, `opspoint-${VER}`);
const OUT = path.join(REL, 'windows');
const isWin = process.platform === 'win32';
// bsdtar (System32\tar.exe) reads .zip and drive letters; Git's GNU tar does neither.
const TAR = isWin ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

function die(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1); }
if (!fs.existsSync(path.join(BUNDLE, 'package.json'))) die(`No ${path.relative(ROOT, BUNDLE)}: run node scripts/release.mjs first.`);
if (!isWin) console.warn('! Not on Windows: the packages staged here would not run on Windows.');

console.log(`\n== Staging OpsPoint Setup ${VER} (Node ${NODE_VERSION}) ==\n`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

console.log('• the bundle and its packages…');
fs.cpSync(BUNDLE, path.join(OUT, 'app'), { recursive: true });
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: path.join(OUT, 'app'), stdio: 'inherit' });
// The encrypted SQLite driver ships prebuilt binaries: it must load here, as the service will.
execFileSync(process.execPath, ['-e', "new (require('better-sqlite3-multiple-ciphers'))(':memory:').prepare('select 1').get()"], { cwd: path.join(OUT, 'app'), stdio: 'inherit' });

if (!process.argv.includes('--skip-node')) {
  console.log(`• Node.js ${NODE_VERSION} for Windows x64…`);
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const zip = `node-v${NODE_VERSION}-win-x64.zip`;
  const get = async (url) => { const r = await fetch(url); if (!r.ok) die(`${url}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
  const sums = String(await get(`${base}/SHASUMS256.txt`));
  const want = (sums.split('\n').find((l) => l.endsWith(`  ${zip}`)) || '').split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(want)) die(`SHASUMS256.txt has no line for ${zip}`);
  const bytes = await get(`${base}/${zip}`);
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== want) die(`${zip} doesn't match nodejs.org's SHASUMS256.txt: not used.`);
  const tmp = path.join(REL, zip);
  fs.writeFileSync(tmp, bytes);
  fs.mkdirSync(path.join(OUT, 'node'), { recursive: true });
  execFileSync(TAR, ['-xf', tmp, '-C', path.join(OUT, 'node'), '--strip-components=1'], { stdio: 'inherit' });
  fs.rmSync(tmp, { force: true });
}

console.log(`\n✓ ${path.relative(ROOT, OUT)}`);
console.log(`Next: ISCC /DAppVersion=${VER} packaging\\windows\\opspoint.iss  ->  release\\OpsPoint-Setup-${VER}.exe\n`);
