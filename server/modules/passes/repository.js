'use strict';
/**
 * Passes repository — the ONLY place that runs SQL for the passes domain.
 * Talks to the database exclusively through server/db/connection.js.
 */
const c = require('../../db/connection');

function _j(str, def) { try { return JSON.parse(str); } catch (e) { return def; } }

const COLUMNS = ['departure', 'return_date', 'ua_notes', 'notes', 'status'];

// Active passes first (Out, then Extended), then everything else by return date.
function list() {
  return c.query(`SELECT * FROM passes ORDER BY
    CASE status WHEN 'Out' THEN 0 WHEN 'Extended' THEN 1 ELSE 2 END, return_date ASC`);
}

function getById(id) {
  return c.query1('SELECT * FROM passes WHERE id=?', [id]);
}

function exists(id) {
  return !!c.query1('SELECT id FROM passes WHERE id=?', [id]);
}

// Cross-table read used to validate/default a pass against its client.
// (Stays here until a clients repository exists; it is a simple read-only lookup.)
function getClientBrief(id) {
  return c.query1('SELECT id,room,name FROM clients WHERE id=?', [id]);
}

function insert({ client_id, room, name, departure, return_date, ua_notes, notes, status }) {
  const info = c.run(`INSERT INTO passes (client_id,room,name,departure,return_date,ua_notes,notes,status)
    VALUES (?,?,?,?,?,?,?,?)`,
    [client_id, room, name, departure, return_date, ua_notes, notes, status]);
  return c.query1('SELECT * FROM passes WHERE id=?', [info.lastInsertRowid]);
}

// Patch only the provided columns; `status` is validated by the caller.
function update(id, fields) {
  for (const col of COLUMNS) {
    if (fields[col] !== undefined) c.run(`UPDATE passes SET ${col}=? WHERE id=?`, [fields[col], id]);
  }
}

function remove(id) {
  c.run('DELETE FROM passes WHERE id=?', [id]);
}

// pass_notice lives in the settings k/v table. Mirrors db.getSetting(): the
// stored value is JSON-parsed with a raw-string fallback. null => unset.
function getNotice() {
  const row = c.query1('SELECT value FROM settings WHERE key=?', ['pass_notice']);
  if (!row) return null;
  return _j(row.value, row.value);
}

function setNotice(str) {
  c.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', ['pass_notice', str]);
}

module.exports = { list, getById, exists, getClientBrief, insert, update, remove, getNotice, setNotice };
