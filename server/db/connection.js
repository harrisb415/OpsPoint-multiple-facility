'use strict';
/**
 * server/db/connection.js — owns the better-sqlite3 handle.
 *
 * The ONLY file that instantiates the database driver. Other code talks to
 * SQLite through the run/query/query1 primitives exported here (and, for the
 * parts of db.js not yet split into repositories, through the shared handle
 * from getDb()). A future SQLite -> Postgres port reimplements this file plus
 * the repositories and nothing else.
 */
// SQLCipher-capable drop-in for better-sqlite3 — identical API plus PRAGMA key.
const Database = require('better-sqlite3-multiple-ciphers');
const fs       = require('fs');
const path     = require('path');
const dbcrypt  = require('../../dbcrypt');

let _db = null;
let _dbPath = null;

// Open (or create) the database and apply connection pragmas. Returns the handle.
//
// openEncrypted() generates a key on first run and transparently converts a
// pre-existing plaintext database (keeping a safety copy). Key loss is
// unrecoverable by design — see dbcrypt.js.
function open(dbPath) {
  _dbPath = dbPath;
  _db = dbcrypt.openEncrypted(Database, dbPath);
  _db.pragma('journal_mode = WAL');   // concurrent reads during writes
  _db.pragma('foreign_keys = ON');    // enforce FK / ON DELETE CASCADE
  return _db;
}

// Consistent snapshot of the live database, for scheduled backups.
//
// VACUUM INTO, not the backup() online-backup API: backup() refuses to run
// against an encrypted source ("incompatible source and target databases")
// because the target it creates has no key. VACUUM INTO is atomic, includes
// WAL contents, and the output inherits the source's encryption.
function backupTo(destPath) {
  if (!_db) return Promise.reject(new Error('database not initialised'));
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true }); // VACUUM INTO needs a free path
    // SQL string literal: forward slashes (Windows backslashes would be
    // mangled) and doubled single quotes.
    _db.exec(`VACUUM INTO '${destPath.replace(/\\/g, '/').replace(/'/g, "''")}'`);
    return Promise.resolve(destPath);
  } catch (e) {
    return Promise.reject(e);
  }
}

function getDb()   { return _db; }
function getPath() { return _dbPath; }

// Low-level primitives. better-sqlite3 caches prepared statements internally,
// so re-preparing the same SQL string is cheap.
function run(sql, params = [])    { return _db.prepare(sql).run(...params); }
function query(sql, params = [])  { return _db.prepare(sql).all(...params); }
function query1(sql, params = []) { return _db.prepare(sql).get(...params) || null; }

module.exports = { open, getDb, getPath, backupTo, run, query, query1 };
