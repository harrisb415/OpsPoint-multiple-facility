'use strict';
/**
 * server/db/drivers/sqlite.js — the better-sqlite3 driver.
 *
 * Lifted verbatim from the old connection.js: same driver, same pragmas, same
 * VACUUM INTO backup. Nothing here changed in the Postgres port, which is the
 * point — this path stays working and switchable until Postgres is proven.
 *
 * Every primitive is SYNCHRONOUS and returns a plain value. Call sites await
 * them anyway (see connection.js): awaiting a non-promise is a no-op, so one
 * set of call sites drives both drivers.
 */
const Database = require('better-sqlite3-multiple-ciphers');
const fs       = require('fs');
const path     = require('path');
const dbcrypt  = require('../../../dbcrypt');

let _db = null;
let _dbPath = null;

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
    if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true });
    _db.exec(`VACUUM INTO '${destPath.replace(/\\/g, '/').replace(/'/g, "''")}'`);
    return Promise.resolve(destPath);
  } catch (e) {
    return Promise.reject(e);
  }
}

function getDb()   { return _db; }
function getPath() { return _dbPath; }

function run(sql, params = [])    { return _db.prepare(sql).run(...params); }
function query(sql, params = [])  { return _db.prepare(sql).all(...params); }
function query1(sql, params = []) { return _db.prepare(sql).get(...params) || null; }
function exec(sql)                { return _db.exec(sql); }

// better-sqlite3 transactions are synchronous and cannot contain awaits. The
// callback receives the same {run, query, query1} shape the Postgres driver
// hands out, so a repository written against one works against the other.
function transaction(fn) {
  const tx = _db.transaction(() => fn({ run, query, query1, exec }));
  return Promise.resolve(tx());
}

async function close() { if (_db) { _db.close(); _db = null; } }

module.exports = { open, getDb, getPath, backupTo, run, query, query1, exec, transaction, close };
