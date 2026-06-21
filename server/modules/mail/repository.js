'use strict';
/**
 * Mail repository — the ONLY place that runs SQL for the mail domain.
 * Talks to the database exclusively through server/db/connection.js.
 *
 * A few reads/writes here cross into other domains (clients lookup, and the
 * consolidated log entry written to the active report's log_entries/reports).
 * They stay here until those domains are extracted; all are isolated below.
 */
const c = require('../../db/connection');

function _j(str, def) { try { return JSON.parse(str); } catch (e) { return def; } }

function list() {
  return c.query('SELECT * FROM mail_log ORDER BY logged_at DESC');
}

function exists(id) {
  return !!c.query1('SELECT id FROM mail_log WHERE id=?', [id]);
}

function getNameRoom(id) {
  return c.query1('SELECT client_name,room FROM mail_log WHERE id=?', [id]);
}

function insert({ client_id, client_name, room, logged_by, logged_at, notes, mail_type }) {
  c.run(
    `INSERT INTO mail_log (client_id,client_name,room,logged_by,logged_at,notes,mail_type,status) VALUES (?,?,?,?,?,?,?,'pending')`,
    [client_id, client_name, room, logged_by, logged_at, notes, mail_type]
  );
}

function approve(id, by, at) {
  c.run(`UPDATE mail_log SET status='approved',approved_by=?,approved_at=? WHERE id=?`, [by, at, id]);
}

function deliver(id, at) {
  c.run(`UPDATE mail_log SET status='delivered',delivered_at=? WHERE id=?`, [at, id]);
}

function remove(id) {
  c.run('DELETE FROM mail_log WHERE id=?', [id]);
}

// ── cross-domain (clients / active report) — temporary home ──────────
function getClientBrief(id) {
  return c.query1('SELECT id,room,name FROM clients WHERE id=?', [id]);
}

function getActiveReportId() {
  const row = c.query1('SELECT value FROM settings WHERE key=?', ['active_report_id']);
  if (!row) return null;
  return _j(row.value, row.value);
}

function insertLogEntry(reportId, time, text) {
  c.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)', [reportId, time, text]);
}

function touchReport(reportId, iso) {
  c.run('UPDATE reports SET updated_at=? WHERE id=?', [iso, reportId]);
}

module.exports = {
  list, exists, getNameRoom, insert, approve, deliver, remove,
  getClientBrief, getActiveReportId, insertLogEntry, touchReport,
};
