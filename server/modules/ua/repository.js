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

function listPending() {
  return c.query(PENDING);
}

function insertRequest({ client_id, client_name, room, requested_by, is_interview, interview_name, requested_at }) {
  c.run(
    `INSERT INTO ua_requests (client_id,client_name,room,requested_by,is_interview,interview_name,requested_at) VALUES (?,?,?,?,?,?,?)`,
    [client_id, client_name, room, requested_by, is_interview, interview_name, requested_at]
  );
}

function getRequestBrief(id) {
  return c.query1('SELECT client_name,room,acknowledged FROM ua_requests WHERE id=?', [id]);
}

function getRequestNameRoom(id) {
  return c.query1('SELECT client_name,room FROM ua_requests WHERE id=?', [id]);
}

function deleteRequest(id) {
  c.run('DELETE FROM ua_requests WHERE id=?', [id]);
}

function acknowledgeRequest(id, by, at) {
  c.run('UPDATE ua_requests SET acknowledged=1, acknowledged_by=?, acknowledged_at=? WHERE id=?', [by, at, id]);
}

// ── UA draws — delegated to db.js (transitional) ────────────────────
function getDraws(since) { return db.getUADraws(since); }
function getRecentDrawnClientIds(days) { return db.getRecentDrawnClientIds(days); }
function createDraw(byId, by, residents) { return db.createUADraw(byId, by, residents); }

module.exports = {
  listPending, insertRequest, getRequestBrief, getRequestNameRoom, deleteRequest,
  acknowledgeRequest, getDraws, getRecentDrawnClientIds, createDraw,
};
