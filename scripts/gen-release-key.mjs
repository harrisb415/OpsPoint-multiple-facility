#!/usr/bin/env node
/**
 * Generate an Ed25519 release signing keypair.
 *
 *   node scripts/gen-release-key.mjs
 *
 *  - writes the PRIVATE key to release-private.pem (gitignored) — BACK THIS UP.
 *    If it is lost you must generate a new pair and re-pin the public key, and
 *    every node must update to a build carrying the new key before it will accept
 *    further releases.
 *  - prints the PUBLIC key PEM to paste into RELEASE_PUBKEY_PEM in BOTH
 *    updater.js and central/updater.js.
 *
 * Refuses to overwrite an existing key (rotation is deliberate — delete first).
 */
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'release-private.pem');

if (fs.existsSync(OUT)) {
  console.error(`\n✗ ${path.relative(ROOT, OUT)} already exists — refusing to overwrite.\n  To rotate the key, delete it first (and plan to re-pin the public key).\n`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
fs.writeFileSync(OUT, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

console.log(`\n✓ wrote ${path.relative(ROOT, OUT)}  (gitignored — BACK THIS UP securely)\n`);
console.log('Pin this PUBLIC key in RELEASE_PUBKEY_PEM (updater.js AND central/updater.js):\n');
process.stdout.write(publicKey.export({ type: 'spki', format: 'pem' }));
console.log('');
