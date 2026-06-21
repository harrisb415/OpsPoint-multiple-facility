'use strict';
/**
 * Violations repository — the ONLY place that runs SQL for the violations domain.
 * Talks to the database exclusively through server/db/connection.js.
 */
const c = require('../../db/connection');

// Banner counts broadcast after every mutation.
function counts() {
  const r = c.query1('SELECT COUNT(*) as c FROM violations WHERE status=?', ['pending']);
  const a = c.query1('SELECT COUNT(*) as c FROM violations WHERE status=?', ['assigned']);
  return { pendingReview: r ? r.c : 0, pendingConsequences: a ? a.c : 0 };
}

// Optional status / client_id filters; newest first.
function listFiltered({ status, client_id } = {}) {
  let sql = 'SELECT * FROM violations';
  const params = [];
  if (status && status !== 'all') { sql += ' WHERE status=?'; params.push(status); }
  if (client_id) { sql += (params.length ? ' AND' : ' WHERE') + ' client_id=?'; params.push(parseInt(client_id)); }
  sql += ' ORDER BY logged_at DESC';
  return c.query(sql, params);
}

function getById(id) {
  return c.query1('SELECT * FROM violations WHERE id=?', [id]);
}

function getClientName(id) {
  return c.query1('SELECT client_name FROM violations WHERE id=?', [id]);
}

function insert({ client_id, client_name, room, violation_date, description, notes, logged_by }) {
  const info = c.run(
    'INSERT INTO violations (client_id,client_name,room,violation_date,description,notes,logged_by) VALUES (?,?,?,?,?,?,?)',
    [client_id, client_name, room, violation_date, description, notes, logged_by]
  );
  return c.query1('SELECT * FROM violations WHERE id=?', [info.lastInsertRowid]);
}

function waive(id, by, at) {
  c.run('UPDATE violations SET status=?,consequence_by=?,consequence_at=? WHERE id=?', ['waived', by, at, id]);
}

function assign(id, consequence, by, at) {
  c.run('UPDATE violations SET status=?,consequence=?,consequence_by=?,consequence_at=? WHERE id=?', ['assigned', consequence, by, at, id]);
}

function complete(id, by, at) {
  c.run('UPDATE violations SET status=?,completed_by=?,completed_at=? WHERE id=?', ['completed', by, at, id]);
}

function remove(id) {
  c.run('DELETE FROM violations WHERE id=?', [id]);
}

module.exports = { counts, listFiltered, getById, getClientName, insert, waive, assign, complete, remove };
