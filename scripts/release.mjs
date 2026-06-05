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
 * Then publish:
 *   gh release create v<ver> release/opspoint-<ver>.zip --title "v<ver>" --notes "..."
 *   git add update-manifest.json && git commit -m "release: v<ver>" && git push
 *
 * The bundle is what the in-app updater downloads, checksum-verifies, and swaps
 * into place. It deliberately excludes node_modules/ and data/.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VER = pkg.version;
const REPO = 'harrisb415/OpsPoint-FULL-HIPAA';

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
  changelog: Array.isArray(prev.changelog) ? prev.changelog : [],
};
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`\n✓ ${path.relative(ROOT, ZIP)}  (${(size / 1048576).toFixed(2)} MB)`);
console.log(`✓ sha256 ${sha256}`);
console.log(`✓ update-manifest.json rewritten for v${VER}`);
console.log(`\nNext:`);
console.log(`  1. Edit update-manifest.json "changelog" for this release`);
console.log(`  2. gh release create v${VER} "${path.relative(ROOT, ZIP)}" --title "v${VER}" --notes-file CHANGELOG.md`);
console.log(`  3. git add update-manifest.json && git commit -m "release: v${VER}" && git push origin master\n`);
