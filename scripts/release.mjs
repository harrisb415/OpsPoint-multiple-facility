#!/usr/bin/env node
/**
 * OpsPoint release builder (Option B updater).
 *
 * Run on the DEV machine after bumping the version in package.json:
 *
 *   node scripts/release.mjs
 *
 * Produces:
 *   release/opspoint-<ver>.zip   — prebuilt runtime bundle (server + dist, no node_modules/data)
 *   update-manifest.json         — rewritten with the new version, sha256, size, url
 *
 * Then publish to the PUBLIC releases repo — attach BOTH the zip and the manifest.
 * The app reads it tokenlessly via .../releases/latest/download/update-manifest.json:
 *   gh release create v<ver> release/opspoint-<ver>.zip update-manifest.json \
 *     -R harrisb415/opspoint-releases --title "v<ver>" --notes-file CHANGELOG.md
 *
 * The bundle is what the in-app updater downloads, checksum-verifies, and swaps
 * into place. It deliberately excludes node_modules/ and data/.
 */
import { execSync, execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign as edSign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VER = pkg.version;
const REPO = 'harrisb415/opspoint-releases'; // PUBLIC releases repo (source repo is private)

// Runtime payload — must match RUNTIME_FILES / RUNTIME_DIRS in updater.js.
const FILES = ['server.js', 'updater.js', 'db.js', 'bootstrap.js', 'package.json', 'package-lock.json', 'generate_cert.js'];
// 'server' = the modular-monolith tree (config/lib/db/middleware/realtime/modules)
// that server.js + db.js now require at runtime; MUST stay in sync with
// updater.js RUNTIME_DIRS or an updated install boots without its modules.
const DIRS = ['migrations', path.join('client', 'dist'), 'server'];

const REL = path.join(ROOT, 'release');
const STAGE = path.join(REL, `opspoint-${VER}`);
const ZIP = path.join(REL, `opspoint-${VER}.tar.gz`);

function sh(cmd, cwd = ROOT) { execSync(cmd, { cwd, stdio: 'inherit' }); }
// Cross-platform gzip-tar with contents at archive root. `tar` is bsdtar on
// Windows/macOS and GNU tar on Linux; both create + read .tar.gz interoperably,
// and `tar -xf` extracts it on every platform (no PowerShell/unzip needed).
// Use paths RELATIVE to REL (cwd) so GNU tar doesn't read a Windows "C:\..."
// path as a remote host (host:path) and fail.
function targz(outFile, stageDir) {
  execFileSync('tar', ['-czf', path.relative(REL, outFile), '-C', path.relative(REL, stageDir), '.'], { cwd: REL, stdio: 'inherit' });
}

console.log(`\n== Building OpsPoint v${VER} release bundle ==\n`);

// 1. Build the frontend
console.log('• building client…');
sh('npm run build', path.join(ROOT, 'client'));

// 2. Stage runtime files
console.log('• staging runtime files…');
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(STAGE, f));
}
for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(STAGE, d), { recursive: true });
}

// 3. Archive (contents at root) as cross-platform .tar.gz
console.log('• archiving (tar.gz)…');
fs.rmSync(ZIP, { force: true });
targz(ZIP, STAGE);

// 4. Hash + size
const buf = fs.readFileSync(ZIP);
const sha256 = createHash('sha256').update(buf).digest('hex');
const size = buf.length;

// 4b. Sign "version\nsize\nsha256" with the Ed25519 release private key. The
// in-app updater refuses any bundle whose signature does not verify against the
// pinned public key, so this step is mandatory.
const KEY_PATH = process.env.OPSPOINT_RELEASE_KEY_FILE || path.join(ROOT, 'release-private.pem');
let privPem = process.env.OPSPOINT_RELEASE_KEY || '';
if (!privPem) {
  if (!fs.existsSync(KEY_PATH)) {
    console.error(`\n✗ Release signing key not found.\n  Set OPSPOINT_RELEASE_KEY (PEM contents) or OPSPOINT_RELEASE_KEY_FILE, or place the key at ${path.relative(ROOT, KEY_PATH)}.\n  Generate one with: node scripts/gen-release-key.mjs\n`);
    process.exit(1);
  }
  privPem = fs.readFileSync(KEY_PATH, 'utf8');
}
const signature = edSign(null, Buffer.from(`${VER}\n${size}\n${sha256}`, 'utf8'), createPrivateKey(privPem)).toString('base64');

// 5. Rewrite manifest (preserve changelog/min_* if already present)
const manifestPath = path.join(ROOT, 'update-manifest.json');
let prev = {};
try { prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
const manifest = {
  version: VER,
  released: new Date().toISOString(),
  min_node: prev.min_node || '20.0.0',
  min_from: prev.min_from || '2.3.0',
  mandatory: !!prev.mandatory,
  url: `https://github.com/${REPO}/releases/download/v${VER}/opspoint-${VER}.tar.gz`,
  sha256,
  size,
  sig_alg: 'ed25519',
  signature,
  changelog: Array.isArray(prev.changelog) ? prev.changelog : [],
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

// 6. Central (HQ) bundle + signed manifest. Published alongside the facility
// release (same tag) so latest/download/central-manifest.json always resolves.
let CVER = null, CZIP = null;
const cpkgPath = path.join(ROOT, 'central', 'package.json');
if (fs.existsSync(cpkgPath)) {
  CVER = JSON.parse(fs.readFileSync(cpkgPath, 'utf8')).version;
  console.log(`\n• building central v${CVER}…`);
  const C_FILES = ['server.js', 'db.js', 'updater.js', 'bootstrap.js', 'package.json', 'package-lock.json'];
  const C_DIRS = ['public'];
  const CSTAGE = path.join(REL, `central-${CVER}`);
  CZIP = path.join(REL, `central-${CVER}.tar.gz`);
  fs.rmSync(CSTAGE, { recursive: true, force: true });
  fs.mkdirSync(CSTAGE, { recursive: true });
  for (const f of C_FILES) { const s = path.join(ROOT, 'central', f); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(CSTAGE, f)); }
  for (const d of C_DIRS) { const s = path.join(ROOT, 'central', d); if (fs.existsSync(s)) fs.cpSync(s, path.join(CSTAGE, d), { recursive: true }); }
  fs.rmSync(CZIP, { force: true });
  targz(CZIP, CSTAGE);
  const cbuf = fs.readFileSync(CZIP);
  const csha = createHash('sha256').update(cbuf).digest('hex');
  const csize = cbuf.length;
  const csig = edSign(null, Buffer.from(`${CVER}\n${csize}\n${csha}`, 'utf8'), createPrivateKey(privPem)).toString('base64');
  const cManifestPath = path.join(ROOT, 'central-manifest.json');
  let cprev = {}; try { cprev = JSON.parse(fs.readFileSync(cManifestPath, 'utf8')); } catch {}
  const cManifest = {
    version: CVER, released: new Date().toISOString(),
    min_node: cprev.min_node || '20.0.0', min_from: cprev.min_from || '0.1.0',
    mandatory: !!cprev.mandatory,
    url: `https://github.com/${REPO}/releases/download/v${VER}/central-${CVER}.tar.gz`,
    sha256: csha, size: csize, sig_alg: 'ed25519', signature: csig,
    changelog: Array.isArray(cprev.changelog) ? cprev.changelog : [],
  };
  fs.writeFileSync(cManifestPath, JSON.stringify(cManifest, null, 2) + '\n');
  console.log(`✓ ${path.relative(ROOT, CZIP)}  (${(csize / 1048576).toFixed(2)} MB)  + central-manifest.json`);
}

console.log(`\n✓ ${path.relative(ROOT, ZIP)}  (${(size / 1048576).toFixed(2)} MB)`);
console.log(`✓ sha256 ${sha256}`);
console.log(`✓ update-manifest.json rewritten for v${VER}`);
console.log(`\nNext:`);
console.log(`  1. Edit update-manifest.json "changelog" for this release if needed`);
console.log(`  2. Publish to the PUBLIC releases repo (attach all bundles + manifests):`);
console.log(`       gh release create v${VER} "${path.relative(ROOT, ZIP)}" update-manifest.json${CZIP ? ` "${path.relative(ROOT, CZIP)}" central-manifest.json` : ''} -R ${REPO} --title "v${VER}" --notes-file CHANGELOG.md`);
console.log(`  3. (optional) keep manifest history in source: git add update-manifest.json && git commit -m "release: v${VER}" && git push origin master\n`);
