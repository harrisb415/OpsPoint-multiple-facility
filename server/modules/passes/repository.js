'use strict';
/**
 * Passes repository — the ONLY place that runs SQL for the passes domain.
 * Talks to the database exclusively through server/db/connection.js.
 */
const c = require('../../db/connection');

function _j(str, def) { try { return JSON.parse(str); } catch (e) { return def; } }

const COLUMNS = ['departure', 'return_date', 'ua_notes', 'notes', 'status'];

// Active passes first (Out, then Extended), then everything else by return date.
async function list() {
  return await c.query(`SELECT * FROM passes ORDER BY
    CASE status WHEN 'Out' THEN 0 WHEN 'Extended' THEN 1 ELSE 2 END, return_date ASC`);
}

async function getById(id) {
  return await c.query1('SELECT * FROM passes WHERE id=?', [id]);
}

async function exists(id) {
  return !!await c.query1('SELECT id FROM passes WHERE id=?', [id]);
}

// Cross-table read used to validate/default a pass against its client.
// (Stays here until a clients repository exists; it is a simple read-only lookup.)
async function getClientBrief(id) {
  return await c.query1('SELECT id,room,name FROM clients WHERE id=?', [id]);
}

async function insert({ client_id, room, name, departure, return_date, ua_notes, notes, status }) {
  const info = await c.run(`INSERT INTO passes (client_id,room,name,departure,return_date,ua_notes,notes,status)
    VALUES (?,?,?,?,?,?,?,?)`,
    [client_id, room, name, departure, return_date, ua_notes, notes, status]);
  return await c.query1('SELECT * FROM passes WHERE id=?', [info.lastInsertRowid]);
}

// Patch only the provided columns; `status` is validated by the caller.
async function update(id, fields) {
  for (const col of COLUMNS) {
    if (fields[col] !== undefined) await c.run(`UPDATE passes SET ${col}=? WHERE id=?`, [fields[col], id]);
  }
}

async function remove(id) {
  await c.run('DELETE FROM passes WHERE id=?', [id]);
}

// pass_notice lives in the settings k/v table. Mirrors db.getSetting(): the
// stored value is JSON-parsed with a raw-string fallback. null => unset.
async function getNotice() {
  const row = await c.query1('SELECT value FROM settings WHERE key=?', ['pass_notice']);
  if (!row) return null;
  return _j(row.value, row.value);
}

async function setNotice(str) {
  await c.run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value', ['pass_notice', str]);
}

module.exports = { list, getById, exists, getClientBrief, insert, update, remove, getNotice, setNotice };
