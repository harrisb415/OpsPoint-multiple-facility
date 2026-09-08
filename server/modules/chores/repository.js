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
async function getMasterChores() {
  const row = await c.query1('SELECT value FROM settings WHERE key=?', ['master_chores']);
  if (!row) return [];
  return _j(row.value, row.value);
}

async function setMasterChores(arr) {
  await c.run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=excluded.value', ['master_chores', JSON.stringify(arr)]);
}

async function clientExists(id) {
  return !!await c.query1('SELECT id FROM clients WHERE id=?', [id]);
}

async function getClientNameRoom(id) {
  return await c.query1('SELECT name,room FROM clients WHERE id=?', [id]);
}

// Patch only the provided chore columns on the client (values pre-serialized).
async function updateClientChore(id, fields) {
  for (const col of CLIENT_CHORE_COLUMNS) {
    if (fields[col] !== undefined) await c.run(`UPDATE clients SET ${col}=? WHERE id=?`, [fields[col], id]);
  }
}

async function getChoreLogByDate(date) {
  return await c.query('SELECT * FROM chore_log WHERE log_date=?', [date]);
}

async function getChoreLogRange(from, to) {
  return await c.query('SELECT * FROM chore_log WHERE log_date>=? AND log_date<=? ORDER BY log_date', [from, to]);
}

async function upsertChoreLog(client_id, log_date, initials) {
  await c.run('INSERT INTO chore_log (client_id,log_date,initials) VALUES (?,?,?) ON CONFLICT (client_id,log_date) DO UPDATE SET initials=excluded.initials', [client_id, log_date, initials]);
}

module.exports = {
  getMasterChores, setMasterChores, clientExists, getClientNameRoom,
  updateClientChore, getChoreLogByDate, getChoreLogRange, upsertChoreLog,
};
