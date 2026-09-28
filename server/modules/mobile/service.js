'use strict';
/**
 * The mobile app's data: one small snapshot instead of /api/data. /api/data
 * carries every resident's photo inline as base64 and is re-fetched on every
 * desktop save, which is a lot to push to a phone on cellular; this carries
 * what the phone screens show and nothing else.
 */
const c = require('../../db/connection');
const db = require('../../../db');
const reportLog = require('../../db/reportLog');
const rounds = require('../rounds/service');

const RESIDENT_WHERE = "is_active=1 AND is_special=0 AND name<>'VACANT'";

function parseJson(v, fallback) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || ''); } catch (e) { return fallback; }
}

async function snapshot() {
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

  return {
    facility,
    report,
    residents: await c.query(`SELECT id, room, name FROM clients WHERE ${RESIDENT_WHERE} ORDER BY ${c.roomOrder('room')}, room, id`),
    passes: await c.query("SELECT id, client_id, status, return_date FROM passes WHERE status IN ('Out','Extended')"),
    round: await rounds.current(),
    last_round: await rounds.last(),
    server_time: new Date().toISOString(),
  };
}

module.exports = { snapshot };
