'use strict';
/**
 * Chores repository — the ONLY place that runs SQL for the chores domain.
 * Chore assignments live on the clients row; completions live in chore_log;
 * the master chore list is a settings k/v entry. All via server/db/connection.js.
 */
const c = require('../../db/connection');

function _j(str, def) { try { return JSON.parse(str); } catch (e) { return def; } }

const CLIENT_CHORE_COLUMNS = ['chore', 'chore_time', 'chore_days', 'chore_day_shifts'];

// master_chores k/v (mirrors db.getSetting: JSON-parse w/ raw fallback, [] default).
function getMasterChores() {
  const row = c.query1('SELECT value FROM settings WHERE key=?', ['master_chores']);
  if (!row) return [];
  return _j(row.value, row.value);
}

function setMasterChores(arr) {
  c.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', ['master_chores', JSON.stringify(arr)]);
}

function clientExists(id) {
  return !!c.query1('SELECT id FROM clients WHERE id=?', [id]);
}

function getClientNameRoom(id) {
  return c.query1('SELECT name,room FROM clients WHERE id=?', [id]);
}

// Patch only the provided chore columns on the client (values pre-serialized).
function updateClientChore(id, fields) {
  for (const col of CLIENT_CHORE_COLUMNS) {
    if (fields[col] !== undefined) c.run(`UPDATE clients SET ${col}=? WHERE id=?`, [fields[col], id]);
  }
}

function getChoreLogByDate(date) {
  return c.query('SELECT * FROM chore_log WHERE log_date=?', [date]);
}

function getChoreLogRange(from, to) {
  return c.query('SELECT * FROM chore_log WHERE log_date>=? AND log_date<=? ORDER BY log_date', [from, to]);
}

function upsertChoreLog(client_id, log_date, initials) {
  c.run('INSERT OR REPLACE INTO chore_log (client_id,log_date,initials) VALUES (?,?,?)', [client_id, log_date, initials]);
}

module.exports = {
  getMasterChores, setMasterChores, clientExists, getClientNameRoom,
  updateClientChore, getChoreLogByDate, getChoreLogRange, upsertChoreLog,
};
