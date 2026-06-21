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
const Database = require('better-sqlite3');

let _db = null;
let _dbPath = null;

// Open (or create) the database and apply connection pragmas. Returns the handle.
function open(dbPath) {
  _dbPath = dbPath;
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');   // concurrent reads during writes
  _db.pragma('foreign_keys = ON');    // enforce FK / ON DELETE CASCADE
  return _db;
}

function getDb()   { return _db; }
function getPath() { return _dbPath; }

// Low-level primitives. better-sqlite3 caches prepared statements internally,
// so re-preparing the same SQL string is cheap.
function run(sql, params = [])    { return _db.prepare(sql).run(...params); }
function query(sql, params = [])  { return _db.prepare(sql).all(...params); }
function query1(sql, params = []) { return _db.prepare(sql).get(...params) || null; }

module.exports = { open, getDb, getPath, run, query, query1 };
