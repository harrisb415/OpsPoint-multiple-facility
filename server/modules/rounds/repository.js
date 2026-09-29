'use strict';
/**
 * Rounds repository — SQL for wellness rounds kept on the server: one row per
 * round in wellness_rounds, one per resident checked in wellness_round_marks.
 * At most one round is open at a time (a partial unique index), which is what
 * lets two staff split the floors of the same round from two phones.
 */
const c = require('../../db/connection');

const RESIDENT_WHERE = "is_active=1 AND is_special=0 AND name<>'VACANT'";

async function openRound() {
  return await c.query1("SELECT * FROM wellness_rounds WHERE status='open' ORDER BY id DESC LIMIT 1");
}
async function getRound(id) {
  return await c.query1('SELECT * FROM wellness_rounds WHERE id=?', [id]);
}
async function lastFinished() {
  return await c.query1("SELECT * FROM wellness_rounds WHERE status='finished' ORDER BY id DESC LIMIT 1");
}
async function create({ reportId, userId, userName, now }) {
  const r = await c.run(
    "INSERT INTO wellness_rounds (report_id,status,started_by_id,started_by_name,started_at) VALUES (?,'open',?,?,?)",
    [reportId, userId, userName, now]);
  return r.lastInsertRowid;
}
async function abandon(id, now) {
  await c.run("UPDATE wellness_rounds SET status='abandoned', finished_at=? WHERE id=? AND status='open'", [now, id]);
}

async function marks(roundId) {
  return await c.query('SELECT * FROM wellness_round_marks WHERE round_id=? ORDER BY marked_at, client_id', [roundId]);
}
async function getMark(roundId, clientId) {
  return await c.query1('SELECT * FROM wellness_round_marks WHERE round_id=? AND client_id=?', [roundId, clientId]);
}
async function setMark(roundId, clientId, mark, userId, userName, now) {
  await c.run(
    `INSERT INTO wellness_round_marks (round_id,client_id,mark,marked_by_id,marked_by_name,marked_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT (round_id, client_id) DO UPDATE SET
       mark=excluded.mark, marked_by_id=excluded.marked_by_id,
       marked_by_name=excluded.marked_by_name, marked_at=excluded.marked_at`,
    [roundId, clientId, mark, userId, userName, now]);
}
async function clearMark(roundId, clientId) {
  await c.run('DELETE FROM wellness_round_marks WHERE round_id=? AND client_id=?', [roundId, clientId]);
}

async function activeResidents() {
  return await c.query(`SELECT id, room, name FROM clients WHERE ${RESIDENT_WHERE} ORDER BY ${c.roomOrder('room')}, room, id`);
}
async function activeResident(id) {
  return await c.query1(`SELECT id, room, name FROM clients WHERE id=? AND ${RESIDENT_WHERE}`, [id]);
}
async function resident(id) {
  return await c.query1('SELECT id, room, name FROM clients WHERE id=?', [id]);
}

// The open shift report a round's result is written into, or null.
async function openReport(reportId) {
  if (!reportId) return null;
  const r = await c.query1('SELECT id, is_closed, statuses FROM reports WHERE id=?', [reportId]);
  return r && !r.is_closed ? r : null;
}
async function passesOut() {
  return await c.query("SELECT client_id, status FROM passes WHERE status IN ('Out','Extended')");
}

// Close the round and write its log entry in one transaction; null when
// another phone finished it first.
async function finishRound(id, f) {
  return await c.transaction(async (t) => {
    const upd = await t.run(
      `UPDATE wellness_rounds SET status='finished', finished_by_id=?, finished_by_name=?, finished_at=?,
         notes=?, total=?, missing=? WHERE id=? AND status='open'`,
      [f.userId, f.userName, f.now, f.notes, f.total, f.missing, id]);
    if (!upd.changes) return null;
    const le = await t.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)', [f.reportId, f.time, f.text]);
    await t.run('UPDATE reports SET updated_at=? WHERE id=?', [f.touched || f.now, f.reportId]);
    await t.run('UPDATE wellness_rounds SET log_entry_id=? WHERE id=?', [le.lastInsertRowid, id]);
    return le.lastInsertRowid;
  });
}

// Record a not-located resident as found, with its log entry; null if that
// mark was already resolved.
async function markFound(roundId, clientId, f) {
  return await c.transaction(async (t) => {
    const upd = await t.run(
      `UPDATE wellness_round_marks SET found_at=?, found_by_name=?, found_note=?
        WHERE round_id=? AND client_id=? AND mark='missing' AND found_at IS NULL`,
      [f.now, f.userName, f.note, roundId, clientId]);
    if (!upd.changes) return null;
    const le = await t.run('INSERT INTO log_entries (report_id,time,text) VALUES (?,?,?)', [f.reportId, f.time, f.text]);
    await t.run('UPDATE reports SET updated_at=? WHERE id=?', [f.touched || f.now, f.reportId]);
    return le.lastInsertRowid;
  });
}

module.exports = {
  openRound, getRound, lastFinished, create, abandon,
  marks, getMark, setMark, clearMark,
  activeResidents, activeResident, resident, openReport, passesOut,
  finishRound, markFound,
};
