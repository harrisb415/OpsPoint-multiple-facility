'use strict';
/**
 * Groups repository — SQL for the group-sessions domain.
 *
 * master_groups (settings k/v), the session 404 lookup, and the consolidated
 * active-report log entry run via server/db/connection.js. The group-session
 * CRUD helpers (getGroupSessions/getGroupAttendance/createGroupSession/
 * saveGroupAttendance/deleteGroupSession) still live in db.js and are delegated
 * here for now (used nowhere else); they fold in when fully migrated.
 */
const c = require('../../db/connection');
const db = require('../../../db');
const reportLog = require('../../db/reportLog'); // shared active-report log helpers

function _j(str, def) { try { return JSON.parse(str); } catch (e) { return def; } }

// master_groups k/v (mirrors db.getSetting: JSON-parse w/ raw fallback, [] default).
function getMasterGroups() {
  const row = c.query1('SELECT value FROM settings WHERE key=?', ['master_groups']);
  if (!row) return [];
  return _j(row.value, row.value);
}

function setMasterGroups(arr) {
  c.run('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)', ['master_groups', JSON.stringify(arr)]);
}

function getSessionBrief(id) {
  return c.query1('SELECT id,group_name FROM group_sessions WHERE id=?', [id]);
}

// ── delegated to db.js (transitional) ───────────────────────────────
function getSessions(filter) { return db.getGroupSessions(filter); }
function getAttendance(sessionId) { return db.getGroupAttendance(sessionId); }
function createSession(fields) { return db.createGroupSession(fields); }
function saveAttendance(sessionId, attendees) { return db.saveGroupAttendance(sessionId, attendees); }
function deleteSession(id) { return db.deleteGroupSession(id); }

// ── active-report log helpers — shared (server/db/reportLog) ────────
const getActiveReportId = reportLog.getActiveReportId;
const insertLogEntry = reportLog.insertLogEntry;
const touchReport = reportLog.touchReport;

module.exports = {
  getMasterGroups, setMasterGroups, getSessionBrief,
  getSessions, getAttendance, createSession, saveAttendance, deleteSession,
  getActiveReportId, insertLogEntry, touchReport,
};
