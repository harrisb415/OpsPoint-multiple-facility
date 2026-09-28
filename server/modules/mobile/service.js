'use strict';
/**
 * The mobile app's data: one small snapshot instead of /api/data, plus one
 * resident's card on demand. /api/data carries every resident's photo inline
 * as base64 and is re-fetched on every desktop save, which is a lot to push to
 * a phone on cellular; these carry what the phone screens show and nothing else.
 *
 * Both take the caller's permissions, re-read from the database by the route:
 * what a section needs to be seen on the desktop is what it needs here, and a
 * section the caller can't see is left out, not hidden by the phone.
 */
const c = require('../../db/connection');
const db = require('../../../db');
const reportLog = require('../../db/reportLog');
const { localDate } = require('../../lib/time');
const rounds = require('../rounds/service');

const RESIDENT_WHERE = "is_active=1 AND is_special=0 AND name<>'VACANT'";

function parseJson(v, fallback) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || ''); } catch (e) { return fallback; }
}

async function snapshot(perms = []) {
  const setting = (k, d) => db.getSetting(k, d);
  const facility = {
    name: await setting('facility_name', 'OpsPoint'),
    theme: await setting('facility_theme', 'indigo'),
    walk_areas: await setting('walk_areas', []),
    wellness_schedule: await setting('wellness_schedule', []),
    walk_schedule: await setting('walk_schedule', []),
    ui_visibility: parseJson(await setting('ui_visibility', {}), {}),
    client_statuses: parseJson(await setting('client_statuses', null), null),
  };

  let report = null;
  const reportId = await reportLog.getActiveReportId();
  if (reportId) {
    const r = await c.query1('SELECT id, report_date, shift, mod_name, is_closed, statuses FROM reports WHERE id=?', [reportId]);
    if (r) {
      report = {
        id: r.id, report_date: r.report_date, shift: r.shift || '', mod_name: r.mod_name || '',
        is_closed: !!r.is_closed, statuses: parseJson(r.statuses, {}) || {},
        log_entries: await c.query('SELECT id, time, text FROM log_entries WHERE report_id=? ORDER BY id', [r.id]),
      };
    }
  }

  // Announcements go to whoever holds broadcast.receive, as in the desktop bell.
  const announcements = perms.includes('broadcast.receive')
    ? (await db.getBroadcasts(72)).slice(0, 5).map(b => ({ id: b.id, sender_name: b.sender_name, message: b.message, created_at: b.created_at }))
    : [];

  return {
    facility,
    report,
    residents: await c.query(`SELECT id, room, name FROM clients WHERE ${RESIDENT_WHERE} ORDER BY ${c.roomOrder('room')}, room, id`),
    passes: await c.query("SELECT id, client_id, status, return_date FROM passes WHERE status IN ('Out','Extended')"),
    ua_pending: (await c.query('SELECT DISTINCT client_id FROM ua_requests WHERE acknowledged=0')).map(r => r.client_id),
    announcements,
    round: await rounds.current(),
    last_round: await rounds.last(),
    server_time: new Date().toISOString(),
  };
}

/**
 * One resident's card. Clinical sections are headlines only — status and
 * dates, never a note's content or a plan's goals — and each needs the same
 * permission its desktop screen does. Returns null for no such active
 * resident; `parts` names what was read, for the access audit.
 */
async function residentCard(id, perms = []) {
  const has = (p) => perms.includes(p);
  const r = await c.query1(
    `SELECT id, room, name, case_manager, intake_date, chore, chore_time, chore_days FROM clients WHERE id=? AND ${RESIDENT_WHERE}`, [id]);
  if (!r) return null;
  const parts = ['resident', 'ua'];

  const pass = await c.query1(
    "SELECT status, departure, return_date, extended_by, extended_at FROM passes WHERE client_id=? AND status IN ('Out','Extended') ORDER BY id DESC LIMIT 1", [id]);

  let chore = null;
  if (r.chore) {
    const days = parseJson(r.chore_days, null);
    const log = await c.query1('SELECT initials, am_initials, pm_initials FROM chore_log WHERE client_id=? AND log_date=?', [id, localDate()]);
    chore = {
      name: r.chore, time: r.chore_time || '',
      due_today: !Array.isArray(days) || !days.length || days.map(Number).includes(new Date().getDay()),
      signed_by: log ? (log.initials || log.pm_initials || log.am_initials || '') : '',
    };
  }

  const mailRows = await c.query("SELECT status, COUNT(*) AS n FROM mail_log WHERE client_id=? AND status IN ('pending','approved') GROUP BY status", [id]);
  const mail = { awaiting_approval: 0, to_deliver: 0 };
  for (const m of mailRows) {
    if (m.status === 'pending') mail.awaiting_approval = m.n;
    if (m.status === 'approved') mail.to_deliver = m.n;
  }

  const lastUa = await c.query1('SELECT tested_at, result, collection_method FROM ua_records WHERE client_id=? ORDER BY (tested_at IS NULL), tested_at DESC, id DESC LIMIT 1', [id]);
  const uaPending = await c.query1('SELECT id FROM ua_requests WHERE client_id=? AND acknowledged=0 LIMIT 1', [id]);
  const infractions = await c.query1("SELECT COUNT(*) AS n FROM violations WHERE client_id=? AND status IN ('pending','assigned')", [id]);

  let clinical = null;
  if (['clinical.treatment', 'clinical.notes', 'clinical.assessments', 'milestones.edit', 'milestones.signoff'].some(has)) {
    clinical = {};
    if (has('clinical.treatment')) {
      const t = await c.query1(
        `SELECT t.status, t.plan_date, t.review_date, t.target_date, t.signed_at, u.display_name AS signed_by_name
           FROM treatment_plans t LEFT JOIN users u ON u.id = t.signed_by
          WHERE t.client_id=? ORDER BY t.id DESC LIMIT 1`, [id]);
      clinical.treatment = t || null;
      parts.push('treatment_plans');
    }
    if (has('clinical.notes')) {
      const n = await c.query1(
        `SELECT n.note_type, n.note_date, n.status, n.signed_at, u.display_name AS signed_by_name
           FROM clinical_notes n LEFT JOIN users u ON u.id = n.signed_by
          WHERE n.client_id=? ORDER BY (n.note_date IS NULL), n.note_date DESC, n.id DESC LIMIT 1`, [id]);
      clinical.last_note = n || null;
      parts.push('clinical_notes');
    }
    if (has('clinical.assessments')) {
      const a = await c.query1(
        'SELECT assessment_type, assessment_date, score_label, status FROM assessments WHERE client_id=? ORDER BY (assessment_date IS NULL), assessment_date DESC, id DESC LIMIT 1', [id]);
      clinical.last_assessment = a || null;
      parts.push('assessments');
    }
    if (has('milestones.edit') || has('milestones.signoff')) {
      const m = await c.query1(
        "SELECT phase, objective, target_date, status FROM milestones WHERE client_id=? AND status<>'completed' ORDER BY (target_date IS NULL), target_date, id LIMIT 1", [id]);
      clinical.next_milestone = m || null;
      parts.push('milestones');
    }
  }

  return {
    resident: { id: r.id, room: r.room, name: r.name, case_manager: r.case_manager || '', intake_date: r.intake_date || null },
    pass: pass || null,
    chore,
    mail,
    ua: { last: lastUa || null, pending_request: !!uaPending },
    infractions: { open: infractions ? infractions.n : 0 },
    clinical,
    parts,
  };
}

module.exports = { snapshot, residentCard };
