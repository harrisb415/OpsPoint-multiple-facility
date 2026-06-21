'use strict';
/**
 * Mail service — business logic for the resident-mail domain.
 * No SQL, no req/res. Validation failures throw an Error carrying `.status`.
 */
const repo = require('./repository');
const { nowLocal } = require('../../lib/time');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function list() {
  return repo.list();
}

// Log incoming mail for one or more residents. Accepts a bulk `clients` array or
// a legacy single client_id. `actor` is the resolved display name of the caller.
// Returns { logged: [{client_name,room,notes,mail_type}], wroteActiveLog }.
// `logged` drives the per-record audit; the caller fires the broadcasts.
function logMail(body = {}, { actor } = {}) {
  let list = [];
  if (Array.isArray(body.clients) && body.clients.length) list = body.clients;
  else if (body.client_id) list = [{ client_id: body.client_id, client_name: body.client_name, room: body.room, notes: body.notes }];
  if (!list.length) throw httpError(400, 'No clients selected');

  const { logged_at, log_time } = body;
  const by = String(body.logged_by || actor || '').slice(0, 100);
  const atTime = logged_at || nowLocal();

  const resolved = [];
  for (const item of list) {
    const cid = parseInt(item.client_id);
    if (!cid) continue;
    const client = repo.getClientBrief(cid);
    if (!client) continue;
    resolved.push({
      client_id: client.id,
      client_name: String(item.client_name || client.name || '').slice(0, 200),
      room: String(item.room || client.room || '').slice(0, 20),
      notes: String(item.notes || '').slice(0, 500),
      mail_type: String(item.mail_type || '').replace(/[^a-z,]/g, '').slice(0, 50),
    });
  }
  if (!resolved.length) throw httpError(404, 'No valid clients found');

  for (const r of resolved) {
    repo.insert({ ...r, logged_by: by, logged_at: atTime });
  }

  // One consolidated log entry for the active shift report, if there is one.
  let wroteActiveLog = false;
  const activeId = repo.getActiveReportId();
  if (activeId) {
    const fmt = (r) => {
      const types = (r.mail_type || '').split(',').filter(Boolean)
        .map(t => t.charAt(0).toUpperCase() + t.slice(1)).join('+');
      let s = `${r.client_name} (Rm. ${r.room})`;
      if (types) s += `: ${types}`;
      if (r.notes) s += ` — ${r.notes}`;
      return s;
    };
    const logText = `Mail received — ${resolved.map(fmt).join(' | ')} — by ${by}`;
    const now = new Date();
    const h = now.getHours(), mi = String(now.getMinutes()).padStart(2, '0');
    const autoTime = `${h % 12 || 12}:${mi} ${h >= 12 ? 'PM' : 'AM'}`;
    const timeStr = log_time && /^\d{1,2}:\d{2} [AP]M$/.test(String(log_time)) ? String(log_time) : autoTime;
    repo.insertLogEntry(activeId, timeStr, logText);
    repo.touchReport(activeId, new Date().toISOString());
    wroteActiveLog = true;
  }

  return { logged: resolved, wroteActiveLog };
}

// Approve a logged mail record. Returns its label for the audit.
function approve(id, by) {
  if (!repo.exists(id)) throw httpError(404, 'Not found');
  const m = repo.getNameRoom(id);
  repo.approve(id, by, nowLocal());
  return m ? (m.client_name + ' Rm.' + m.room) : String(id);
}

// Mark an approved mail record as delivered. Returns its label for the audit.
function deliver(id) {
  const m = repo.getNameRoom(id);
  if (!m) throw httpError(404, 'Not found');
  repo.deliver(id, nowLocal());
  return m.client_name + ' Rm.' + m.room;
}

// Delete a mail record. Returns its label for the audit.
function remove(id) {
  const m = repo.getNameRoom(id);
  if (!m) throw httpError(404, 'Not found');
  repo.remove(id);
  return m.client_name + ' Rm.' + m.room;
}

module.exports = { list, logMail, approve, deliver, remove };
