'use strict';
/**
 * Wellness rounds, kept on the server so a round survives a reload or a dead
 * zone and several phones can work the same round at once.
 *
 * A round is started, residents are marked seen ('ok') or not located
 * ('missing') one tap at a time, and finishing it writes the same shift-log
 * line the desktop wellness check writes, so reminders, the archive and the
 * DOCX export read it without knowing where it came from. Residents away
 * (any status but In Building, passes included) count as accounted for.
 */
const db = require('../../../db');
const reportLog = require('../../db/reportLog');
const { sanitizeText } = require('../../lib/text');
const { fmtClock } = require('../../lib/schedule');
const repo = require('./repository');

// A round left open this long is abandoned; the next start begins afresh.
const STALE_MS = 2 * 3600000;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function shape(round, marks) {
  if (!round) return null;
  return {
    id: round.id,
    status: round.status,
    started_at: round.started_at,
    started_by: round.started_by_name || '',
    finished_at: round.finished_at || null,
    finished_by: round.finished_by_name || '',
    total: round.total || 0,
    missing: round.missing || 0,
    notes: round.notes || '',
    marks: marks.map(m => ({
      client_id: m.client_id, mark: m.mark, by: m.marked_by_name || '', at: m.marked_at,
      found_at: m.found_at || null, found_by: m.found_by_name || '',
    })),
  };
}

const isStale = (round) => Date.now() - Date.parse(round.started_at) > STALE_MS;

async function current() {
  const r = await repo.openRound();
  if (!r) return null;
  if (isStale(r)) { await repo.abandon(r.id, new Date().toISOString()); return null; }
  return shape(r, await repo.marks(r.id));
}

async function last() {
  const r = await repo.lastFinished();
  return r ? shape(r, await repo.marks(r.id)) : null;
}

async function openReportOrThrow(message) {
  const report = await repo.openReport(await reportLog.getActiveReportId());
  if (!report) throw httpError(409, message);
  return report;
}

async function start(user) {
  const open = await current();
  if (open) return { round: open, joined: true };
  const report = await openReportOrThrow('No shift report is open. Start one on the desktop first.');
  try {
    const id = await repo.create({ reportId: report.id, userId: user.id, userName: user.name, now: new Date().toISOString() });
    return { round: shape(await repo.getRound(id), []), joined: false };
  } catch (e) {
    // Two phones pressed Start together: the unique index let one through.
    const raced = await current();
    if (raced) return { round: raced, joined: true };
    throw e;
  }
}

async function openRoundOrThrow(roundId) {
  const r = await repo.getRound(roundId);
  if (!r) throw httpError(404, 'Round not found');
  if (r.status !== 'open') throw httpError(409, 'This round is already finished.');
  if (isStale(r)) {
    await repo.abandon(r.id, new Date().toISOString());
    throw httpError(409, 'This round was left open too long and has been closed. Start a new one.');
  }
  return r;
}

async function mark(roundId, clientId, value, user) {
  const r = await openRoundOrThrow(roundId);
  const resident = await repo.activeResident(clientId);
  if (!resident) throw httpError(404, 'Resident not found');
  const now = new Date().toISOString();
  if (value === null) await repo.clearMark(r.id, resident.id);
  else if (value === 'ok' || value === 'missing') await repo.setMark(r.id, resident.id, value, user.id, user.name, now);
  else throw httpError(400, "mark must be 'ok', 'missing' or null");
  return { round_id: r.id, client_id: resident.id, mark: value, by: user.name, at: now };
}

// Residents whose status right now is anything but In Building. Mirrors
// effectiveStatuses() in client/src/utils/statuses.js: a pass that is Out or
// Extended means Weekend Pass whatever the report stored, while Passes is on.
async function awayIds(report) {
  let stored = {};
  try { stored = typeof report.statuses === 'string' ? JSON.parse(report.statuses || '{}') : (report.statuses || {}); }
  catch (e) { stored = {}; }
  const eff = { ...(stored || {}) };
  const vis = (await db.getSetting('ui_visibility', {})) || {};
  if (vis.tabs?.passes !== false) for (const p of await repo.passesOut()) eff[p.client_id] = 'pass';
  const away = new Set();
  for (const [id, st] of Object.entries(eff)) if (st && st !== 'building') away.add(Number(id));
  return away;
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

async function finish(roundId, user, { notes = '' } = {}) {
  const r = await openRoundOrThrow(roundId);
  const report = await openReportOrThrow('No shift report is open, so the round has nowhere to be logged. Start one on the desktop, then finish the round.');
  const residents = await repo.activeResidents();
  const marks = await repo.marks(r.id);
  const byClient = new Map(marks.map(m => [m.client_id, m]));
  const away = await awayIds(report);

  const notLocated = residents.filter(c => byClient.get(c.id)?.mark === 'missing');
  const unchecked = residents.filter(c => !byClient.has(c.id) && !away.has(c.id));
  const total = residents.length;
  const rm = list => list.map(c => `Rm. ${c.room} ${c.name}`).join(', ');

  const names = [];
  for (const m of marks) if (m.marked_by_name && !names.includes(m.marked_by_name)) names.push(m.marked_by_name);
  if (user.name && !names.includes(user.name)) names.push(user.name);

  let text = `Wellness check conducted${names.length ? ` by ${joinNames(names)}` : ''}. `;
  if (!notLocated.length && !unchecked.length) text += `All ${total} clients accounted for.`;
  else {
    text += `${total - notLocated.length - unchecked.length} of ${total} clients accounted for.`;
    if (notLocated.length) text += ` Not located: ${rm(notLocated)}.`;
    if (unchecked.length) text += ` Not checked: ${rm(unchecked)}.`;
  }
  const cleanNotes = sanitizeText(String(notes || '').trim(), 500);
  if (cleanNotes) text += ` Notes: ${cleanNotes}`;
  text = text.slice(0, 2000);

  const now = new Date();
  const time = fmtClock(now);
  const logEntryId = await repo.finishRound(r.id, {
    userId: user.id, userName: user.name, now: now.toISOString(), notes: cleanNotes,
    total, missing: notLocated.length, reportId: report.id, time, text,
  });
  if (!logEntryId) throw httpError(409, 'This round is already finished.');
  return { reportId: report.id, logEntry: { id: logEntryId, time, text }, total, missing: notLocated.length, unchecked: unchecked.length, time };
}

// Follow-up for a resident marked not located on a finished round.
async function found(roundId, clientId, user, { note = '' } = {}) {
  const r = await repo.getRound(roundId);
  if (!r) throw httpError(404, 'Round not found');
  if (r.status !== 'finished') throw httpError(409, 'The round is still open: mark them seen on the round instead.');
  const m = await repo.getMark(r.id, clientId);
  if (!m || m.mark !== 'missing') throw httpError(404, 'That resident was not marked not located on this round');
  if (m.found_at) throw httpError(409, 'Already recorded as found');
  const report = await openReportOrThrow('No shift report is open to log this in. Start one on the desktop first.');
  const resident = await repo.resident(clientId);
  const now = new Date();
  const time = fmtClock(now);
  const cleanNote = sanitizeText(String(note || '').trim(), 300);
  const who = resident ? `Rm. ${resident.room} ${resident.name}` : 'Resident';
  const text = `${who} located at ${time}, reported by ${user.name}.${cleanNote ? ` Notes: ${cleanNote}` : ''}`.slice(0, 2000);
  const logEntryId = await repo.markFound(r.id, clientId, { now: now.toISOString(), userName: user.name, note: cleanNote, reportId: report.id, time, text });
  if (!logEntryId) throw httpError(409, 'Already recorded as found');
  return { reportId: report.id, logEntry: { id: logEntryId, time, text }, label: who };
}

module.exports = { current, last, start, mark, finish, found, awayIds, _awayIds: awayIds };
