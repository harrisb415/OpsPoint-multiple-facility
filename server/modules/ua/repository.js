'use strict';
/**
 * UA repository — SQL for the urinalysis domain (requests + draws).
 *
 * ua_requests rows are handled directly via server/db/connection.js. The UA-draw
 * helpers still live in db.js (createUADraw/getUADraws/getRecentDrawnClientIds);
 * they are delegated here for now and will fold into this repo when the draws
 * sub-domain is fully migrated. They are used nowhere else.
 */
const c = require('../../db/connection');
const db = require('../../../db');

const PENDING = 'SELECT * FROM ua_requests WHERE acknowledged=0 ORDER BY requested_at DESC';

async function listPending() {
  return await c.query(PENDING);
}

async function insertRequest({ client_id, client_name, room, requested_by, is_interview, interview_name, requested_at }) {
  await c.run(
    `INSERT INTO ua_requests (client_id,client_name,room,requested_by,is_interview,interview_name,requested_at) VALUES (?,?,?,?,?,?,?)`,
    [client_id, client_name, room, requested_by, is_interview, interview_name, requested_at]
  );
}

async function getRequestBrief(id) {
  return await c.query1('SELECT client_name,room,acknowledged FROM ua_requests WHERE id=?', [id]);
}

async function getRequestNameRoom(id) {
  return await c.query1('SELECT client_name,room FROM ua_requests WHERE id=?', [id]);
}

async function deleteRequest(id) {
  await c.run('DELETE FROM ua_requests WHERE id=?', [id]);
}

async function acknowledgeRequest(id, by, at) {
  await c.run('UPDATE ua_requests SET acknowledged=1, acknowledged_by=?, acknowledged_at=? WHERE id=?', [by, at, id]);
}

// ── UA draws — delegated to db.js (transitional) ────────────────────
async function getDraws(since) { return await db.getUADraws(since); }
async function getRecentDrawnClientIds(days) { return await db.getRecentDrawnClientIds(days); }
async function createDraw(byId, by, residents) { return await db.createUADraw(byId, by, residents); }

// ── UA log — log entries tagged with a UA result, newest first ──────
const UA_LOG_SQL = `
    SELECT le.id, le.text, le.time, le.ua_photo, le.created_at,
           r.report_date, r.shift, r.id AS report_id
    FROM log_entries le
    JOIN reports r ON r.id = le.report_id
    WHERE le.text LIKE '% — UA:%'
    ORDER BY r.report_date DESC, r.id DESC, le.id DESC
    LIMIT ? OFFSET ?`;
async function getUALog(limit, offset) { return await c.query(UA_LOG_SQL, [limit, offset]); }

module.exports = {
  listPending, insertRequest, getRequestBrief, getRequestNameRoom, deleteRequest,
  acknowledgeRequest, getDraws, getRecentDrawnClientIds, createDraw, getUALog,
};
