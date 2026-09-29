'use strict';
/**
 * Violations repository — the ONLY place that runs SQL for the violations domain.
 * Talks to the database exclusively through server/db/connection.js.
 */
const c = require('../../db/connection');

// Banner counts broadcast after every mutation.
async function counts() {
  const r = await c.query1('SELECT COUNT(*) as c FROM violations WHERE status=?', ['pending']);
  const a = await c.query1('SELECT COUNT(*) as c FROM violations WHERE status=?', ['assigned']);
  return { pendingReview: r ? r.c : 0, pendingConsequences: a ? a.c : 0 };
}

// Optional status / client_id filters; newest first.
async function listFiltered({ status, client_id } = {}) {
  let sql = 'SELECT * FROM violations';
  const params = [];
  if (status && status !== 'all') { sql += ' WHERE status=?'; params.push(status); }
  if (client_id) { sql += (params.length ? ' AND' : ' WHERE') + ' client_id=?'; params.push(parseInt(client_id)); }
  sql += ' ORDER BY logged_at DESC';
  return await c.query(sql, params);
}

async function getById(id) {
  return await c.query1('SELECT * FROM violations WHERE id=?', [id]);
}


async function insert({ client_id, client_name, room, violation_date, description, notes, staff_name, logged_by }) {
  const info = await c.run(
    'INSERT INTO violations (client_id,client_name,room,violation_date,description,notes,staff_name,logged_by) VALUES (?,?,?,?,?,?,?,?)',
    [client_id, client_name, room, violation_date, description, notes, staff_name, logged_by]
  );
  return await c.query1('SELECT * FROM violations WHERE id=?', [info.lastInsertRowid]);
}

async function waive(id, by, at) {
  await c.run('UPDATE violations SET status=?,consequence_by=?,consequence_at=? WHERE id=?', ['waived', by, at, id]);
}

async function assign(id, consequence, by, at) {
  await c.run('UPDATE violations SET status=?,consequence=?,consequence_by=?,consequence_at=? WHERE id=?', ['assigned', consequence, by, at, id]);
}

async function complete(id, by, at) {
  await c.run('UPDATE violations SET status=?,completed_by=?,completed_at=? WHERE id=?', ['completed', by, at, id]);
}

// Infractions are never deleted: voided, they stay on file with who, when and
// why. False if it was already void.
async function voidRow(id, v) {
  const r = await c.run(`UPDATE violations SET status='voided', voided_at=?, voided_by_id=?, voided_by_name=?, void_reason=?
    WHERE id=? AND voided_at IS NULL`, [v.at, v.byId, v.byName, v.reason, id]);
  return !!(r && r.changes);
}

module.exports = { counts, listFiltered, getById, insert, waive, assign, complete, voidRow };
