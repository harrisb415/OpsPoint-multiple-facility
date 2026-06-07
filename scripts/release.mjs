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
import { execSync } from 'node:child_process';
import { createHash, createPrivateKey, sign as edSign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VER = pkg.version;
const REPO = 'harrisb415/opspoint-releases'; // PUBLIC releases repo (source repo is private)

// Runtime payload — must match RUNTIME_FILES / RUNTIME_DIRS in updater.js.
const FILES = ['server.js', 'updater.js', 'db.js', 'package.json', 'package-lock.json', 'generate_cert.js'];
const DIRS = ['migrations', path.join('client', 'dist')];

const REL = path.join(ROOT, 'release');
const STAGE = path.join(REL, `opspoint-${VER}`);
const ZIP = path.join(REL, `opspoint-${VER}.zip`);

function sh(cmd, cwd = ROOT) { execSync(cmd, { cwd, stdio: 'inherit' }); }
function ps(cmd) { execSync(`powershell -NoProfile -NonInteractive -Command "${cmd.replace(/"/g, '\\"')}"`, { stdio: 'inherit' }); }

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

// 3. Zip (contents at zip root) via PowerShell Compress-Archive
console.log('• zipping…');
fs.rmSync(ZIP, { force: true });
ps(`Compress-Archive -Path '${STAGE.replace(/'/g, "''")}\\*' -DestinationPath '${ZIP.replace(/'/g, "''")}' -Force`);

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
  url: `https://github.com/${REPO}/releases/download/v${VER}/opspoint-${VER}.zip`,
  sha256,
  size,
  sig_alg: 'ed25519',
  signature,
  changelog: Array.isArray(prev.changelog) ? prev.changelog : [],
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`\n✓ ${path.relative(ROOT, ZIP)}  (${(size / 1048576).toFixed(2)} MB)`);
console.log(`✓ sha256 ${sha256}`);
console.log(`✓ update-manifest.json rewritten for v${VER}`);
console.log(`\nNext:`);
console.log(`  1. Edit update-manifest.json "changelog" for this release if needed`);
console.log(`  2. Publish to the PUBLIC releases repo (attach BOTH zip + manifest):`);
console.log(`       gh release create v${VER} "${path.relative(ROOT, ZIP)}" update-manifest.json -R ${REPO} --title "v${VER}" --notes-file CHANGELOG.md`);
console.log(`  3. (optional) keep manifest history in source: git add update-manifest.json && git commit -m "release: v${VER}" && git push origin master\n`);
