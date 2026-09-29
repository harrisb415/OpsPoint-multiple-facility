// ═══════════════════════════════════════════════════════════════════════
//  Database encryption at rest (SQLCipher via better-sqlite3-multiple-ciphers)
//
//  WHAT THIS PROTECTS
//    The database file, and every backup taken from it, are unreadable
//    without the key. That covers a backup drive leaving the building, a
//    copied file, or disk forensics on a decommissioned machine.
//
//  WHAT THIS DOES NOT PROTECT
//    The key file lives beside the database so an unattended service can
//    boot without a human typing a passphrase. Anyone who takes the WHOLE
//    VOLUME takes both. Full-disk encryption (BitLocker) is what covers
//    that case, and remains necessary — these are complementary, not
//    alternatives.
//
//  KEY LOSS = TOTAL DATA LOSS. There is no recovery path, by design.
//  The key file must be backed up separately from the database backups,
//  or the backups are worthless.
//
//  Opt out by setting OPSPOINT_ENCRYPT=0 (an existing encrypted database is
//  then left alone and will simply fail to open — decrypt it deliberately
//  rather than by flipping a flag).
// ═══════════════════════════════════════════════════════════════════════

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'utf8');

function keyPathFor(dbPath) {
  return path.join(path.dirname(dbPath), '.dbkey');
}

// A plaintext SQLite file begins with the 16-byte magic header. An encrypted
// one begins with ciphertext, so this is a reliable discriminator.
function isPlaintextDb(dbPath) {
  let fd;
  try {
    fd = fs.openSync(dbPath, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    return head.equals(SQLITE_MAGIC);
  } catch (e) {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) {} }
  }
}

// Load the key, generating one on first run. Mirrors the session-secret
// pattern already used in server.js: 32 random bytes, hex, mode 0600.
function loadOrCreateKey(dbPath) {
  const kp = keyPathFor(dbPath);
  if (fs.existsSync(kp)) {
    const key = fs.readFileSync(kp, 'utf8').trim();
    if (!key) throw new Error(`Encryption key file is empty: ${kp}`);
    return { key, created: false, keyPath: kp };
  }
  fs.mkdirSync(path.dirname(kp), { recursive: true });
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(kp, key, { mode: 0o600 });
  try { fs.chmodSync(kp, 0o600); } catch (e) {}
  return { key, created: true, keyPath: kp };
}

function _announceNewKey(keyPath) {
  console.log('');
  console.log('  ┌────────────────────────────────────────────────────────────┐');
  console.log('  │  DATABASE ENCRYPTION KEY CREATED                            │');
  console.log('  ├────────────────────────────────────────────────────────────┤');
  console.log('  │  Back this file up somewhere separate from the database.    │');
  console.log('  │  Without it the database AND every backup are unreadable.   │');
  console.log('  │  There is no recovery path.                                 │');
  console.log('  └────────────────────────────────────────────────────────────┘');
  console.log('  Key file:', keyPath);
  console.log('');
}

// Convert an existing plaintext database to an encrypted one in place.
// A safety copy is written first and kept — migration is the one moment
// where a crash could otherwise cost the whole database.
function migratePlaintextToEncrypted(Database, dbPath, key) {
  const safety = `${dbPath}.pre-encryption-${Date.now()}.bak`;

  console.log('  DB: plaintext database found — encrypting in place');
  fs.copyFileSync(dbPath, safety);
  console.log('  DB: safety copy →', path.basename(safety));

  // SQLite3 Multiple Ciphers encrypts an open plaintext database in place via
  // PRAGMA rekey. (Note: this is NOT SQLCipher's sqlcipher_export(), which
  // this fork does not provide.) Switching off WAL first keeps the rekey to a
  // single file with no sidecars to reconcile.
  const plain = new Database(dbPath);
  try {
    try { plain.pragma('journal_mode = DELETE'); } catch (e) {}
    plain.pragma(`rekey='${key.replace(/'/g, "''")}'`);
  } catch (e) {
    try { plain.close(); } catch (e2) {}
    throw new Error(
      `Encryption failed: ${e.message}. The database was left as-is and a ` +
      `safety copy is at ${safety}.`
    );
  } finally {
    try { plain.close(); } catch (e) {}
  }

  if (isPlaintextDb(dbPath)) {
    throw new Error(
      `Encryption reported success but the file is still plaintext. ` +
      `Database untouched; safety copy at ${safety}.`
    );
  }

  console.log('  DB: encrypted. Safety copy retained (delete once verified):');
  console.log('      ', safety);
  return safety;
}

// Open the database, encrypting it on the way if needed.
// Returns the open connection.
function openEncrypted(Database, dbPath) {
  const enabled = process.env.OPSPOINT_ENCRYPT !== '0';
  const exists  = fs.existsSync(dbPath);

  if (!enabled) {
    console.warn('  DB: encryption DISABLED (OPSPOINT_ENCRYPT=0) — PHI is stored in plaintext');
    return new Database(dbPath);
  }

  const { key, created, keyPath } = loadOrCreateKey(dbPath);
  if (created) _announceNewKey(keyPath);

  if (exists && isPlaintextDb(dbPath)) {
    migratePlaintextToEncrypted(Database, dbPath, key);
  }

  const conn = new Database(dbPath);
  conn.pragma(`key='${key.replace(/'/g, "''")}'`);

  // Force a real read so a wrong/corrupt key fails loudly here rather than
  // surfacing as mysterious "file is not a database" errors later.
  try {
    conn.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch (e) {
    try { conn.close(); } catch (e2) {}
    throw new Error(
      `Cannot open the database with the key at ${keyPath}. ` +
      `If the key was lost or replaced, restore the matching key file — ` +
      `the data cannot be recovered without it. (${e.message})`
    );
  }

  return conn;
}

module.exports = { openEncrypted, isPlaintextDb, loadOrCreateKey, keyPathFor };
