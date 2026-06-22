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
const reportLog = require('../../db/reportLog'); // shared active-report log helpers

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

// active-report log helpers — shared (server/db/reportLog)
const getActiveReportId = reportLog.getActiveReportId;
const insertLogEntry = reportLog.insertLogEntry;
const touchReport = reportLog.touchReport;

module.exports = {
  list, exists, getNameRoom, insert, approve, deliver, remove,
  getClientBrief, getActiveReportId, insertLogEntry, touchReport,
};
