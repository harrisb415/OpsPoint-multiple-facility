'use strict';
/**
 * server/archive/columns.js — what an export may carry, and how its times
 * cross between SQLite and Postgres.
 *
 * Postgres keeps instants as timestamptz, which the driver hands back as ISO
 * text with a zone. SQLite keeps them as text WITHOUT a zone, in one of the
 * forms the app writes, column by column:
 *   utc    the column's own default, datetime('now'): UTC
 *   local  nowLocal(): the facility's local time, 'YYYY-MM-DD HH:MM:SS'
 *   input  a date-and-time field: local time, 'YYYY-MM-DDTHH:MM'
 *   iso    new Date().toISOString() (older rows may still be zone-less: then
 *          UTC when the column has a datetime('now') default, else local)
 * An archive holds every instant as ISO UTC, so either side reads it the same.
 * tests/archive.test.js holds this registry to the Postgres schema: a new
 * timestamptz or date column fails the test until it is listed here.
 */

// Tables that don't travel: the server's own bookkeeping, and what is tied to
// one machine or one device (sessions, phone PINs, push registrations, invite
// links that name the old address, the HQ outbox, migration records).
const EXCLUDED_TABLES = [
  'sessions', 'app_instances', 'idempotency_keys', 'schema_migrations', 'sync_outbox',
  'device_pins', 'push_subscriptions', 'user_invites',
];

// Settings that belong to the machine, not the facility.
const MACHINE_SETTINGS = ['backup_dir', 'backup_same_volume_ack', 'dbkey_backup_confirmed', 'push_sent'];
// The link to HQ: left behind unless the export is meant to replace this
// install (otherwise a restored copy would report to HQ as the same facility).
const HQ_SETTINGS = [
  'central_url', 'central_facility_id', 'central_api_key', 'central_insecure_tls', 'central_manages_users',
  'central_target_version', 'central_auto_update', 'central_update_window',
  'update_manifest_url', 'update_manifest_url_origin',
];
// HQ status that the next check-in rewrites anyway.
const HQ_STATUS_SETTINGS = [
  'central_last_checkin', 'central_last_status', 'central_last_sync', 'central_sync_error',
  'central_users_last_pull', 'central_users_count',
];

const INSTANTS = {
  assessments: { signed_at: 'local', created_at: 'local', updated_at: 'local' },
  audit_log: { ts: 'local' },
  broadcast_messages: { created_at: 'utc' },
  clinical_notes: { signed_at: 'local', created_at: 'local', updated_at: 'local' },
  consent_records: { revoked_at: 'local', created_at: 'utc' },
  discharge_records: { created_at: 'utc' },
  discharge_summaries: { signed_at: 'local', created_at: 'local', updated_at: 'local' },
  disclosures: { disclosed_at: 'utc' },
  group_notes: { signed_at: 'local', created_at: 'local', updated_at: 'local' },
  group_sessions: { created_at: 'local' },
  groups: { created_at: 'utc' },
  incidents: { reviewed_at: 'local', locked_at: 'local', unlocked_at: 'local', created_at: 'utc', voided_at: 'iso' },
  log_entries: { created_at: 'utc', voided_at: 'iso' },
  mail_log: { logged_at: 'local', approved_at: 'local', delivered_at: 'local', created_at: 'utc' },
  milestones: { signed_off_at: 'local', locked_at: 'local', unlocked_at: 'local', created_at: 'utc' },
  passes: { departure: 'input', return_date: 'input', created_at: 'utc', extended_at: 'iso', extended_from: 'input' },   // extended_from: the return_date it replaced
  reports: { created_at: 'iso', updated_at: 'iso' },
  staff: { created_at: 'utc' },
  treatment_plans: { signed_at: 'local', created_at: 'local', updated_at: 'local' },
  ua_draws: { created_at: 'utc' },
  ua_records: { tested_at: 'iso', locked_at: 'local', unlocked_at: 'local', created_at: 'utc', voided_at: 'iso' },
  ua_requests: { requested_at: 'local', acknowledged_at: 'local' },
  users: { created_at: 'utc' },
  violations: { logged_at: 'utc', consequence_at: 'local', completed_at: 'local', created_at: 'utc', voided_at: 'iso' },
  wellness_round_marks: { marked_at: 'iso', found_at: 'iso' },
  wellness_rounds: { started_at: 'iso', finished_at: 'iso' },
};

// Calendar dates: 'YYYY-MM-DD' on both sides (SQLite's '' becomes null).
const DATES = {
  assessments: ['assessment_date'],
  chore_log: ['log_date'],
  clients: ['intake_date', 'discharge_date'],
  clinical_notes: ['note_date'],
  consent_records: ['effective_date', 'expiration_date'],
  discharge_records: ['intake_date', 'discharge_date'],
  discharge_summaries: ['discharge_date', 'admission_date', 'follow_up_date'],
  group_notes: ['session_date'],
  group_sessions: ['session_date'],
  incidents: ['incident_date'],
  milestones: ['target_date', 'completion_date'],
  reports: ['report_date'],
  treatment_plans: ['plan_date', 'target_date', 'review_date'],
  violations: ['violation_date'],
};

// Every foreign key in either schema, child.column -> parent table. Tables
// load in an order that follows them, so a row always arrives after the one
// it points at — whichever database it is going to. (Postgres has five that
// SQLite lacks: an export from SQLite can hold a reference to a row deleted
// long ago, which import then leaves empty, as ON DELETE SET NULL would have.)
const FK_EDGES = {
  'assessments.author_id': 'users', 'assessments.client_id': 'clients', 'assessments.signed_by': 'users',
  'clinical_notes.author_id': 'users', 'clinical_notes.client_id': 'clients', 'clinical_notes.signed_by': 'users',
  'device_pins.user_id': 'users',
  'discharge_summaries.author_id': 'users', 'discharge_summaries.client_id': 'clients', 'discharge_summaries.signed_by': 'users',
  'disclosures.consent_id': 'consent_records',
  'group_attendance.session_id': 'group_sessions',
  'group_note_attendees.client_id': 'clients', 'group_note_attendees.group_note_id': 'group_notes',
  'group_notes.facilitator_id': 'users', 'group_notes.signed_by': 'users',
  'idempotency_keys.user_id': 'users',
  'log_entries.report_id': 'reports',
  'mail_log.report_id': 'reports',
  'push_subscriptions.user_id': 'users',
  'treatment_plans.author_id': 'users', 'treatment_plans.client_id': 'clients', 'treatment_plans.signed_by': 'users',
  'ua_records.log_entry_id': 'log_entries', 'ua_records.report_id': 'reports', 'ua_records.ua_request_id': 'ua_requests',
  'user_groups.group_id': 'groups', 'user_groups.user_id': 'users',
  'user_invites.user_id': 'users',
  'wellness_round_marks.round_id': 'wellness_rounds',
};

// Columns holding a photo reference ('photos/<name>' in the file storage, or
// on old rows a whole data: URI, which simply travels in the row).
const PHOTO_COLUMNS = { clients: ['photo'], ua_records: ['photo'], log_entries: ['ua_photo'] };

// ── Time zones without a library ────────────────────────────────────────────
const _fmts = {};
function zoneParts(ms, zone) {
  const f = _fmts[zone] || (_fmts[zone] = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }));
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}
// The zone's offset from UTC at an instant, in ms (whole minutes).
function offsetMs(ms, zone) {
  const whole = ms - (((ms % 1000) + 1000) % 1000);
  const p = zoneParts(whole, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}
const WALL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;
// A time with its zone: Z, +01:00, +0100 or Postgres's own +01.
const ZONED = /\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const isoZoned = (s) => s.replace(' ', 'T').replace(/\s+(?=[Z+-][^-]*$)/i, '')
  .replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');

// A wall-clock time in `zone` -> ms. NaN when it isn't one. At a change of
// clocks, a time that happens twice is the first of them.
function wallToMs(text, zone) {
  const m = WALL.exec(String(text).trim());
  if (!m) return NaN;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), +String(m[7] || '0').slice(0, 3).padEnd(3, '0'));
  let ms = asUtc - offsetMs(asUtc, zone);
  ms = asUtc - offsetMs(ms, zone);
  return ms;
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
function msToWall(ms, zone, sep = ' ', seconds = true) {
  const p = zoneParts(ms, zone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}${sep}${pad(p.hour)}:${pad(p.minute)}${seconds ? `:${pad(p.second)}` : ''}`;
}
function msToUtcText(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * A stored instant -> ISO UTC for the archive, or null. `kind` from INSTANTS;
 * `zone` is the facility's (for local text); `defaultUtc` says whether the
 * SQLite column defaults to datetime('now') (for zone-less 'iso' leftovers).
 * Returns { value } or { problem } for text that isn't a time.
 */
function instantToArchive(raw, kind, zone, defaultUtc = false) {
  if (raw === null || raw === undefined) return { value: null };
  if (raw instanceof Date) return { value: raw.toISOString() };
  let s = String(raw).trim();
  if (!s) return { value: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += ' 00:00:00';     // a bare date: its midnight, as Postgres reads it
  let ms;
  if (ZONED.test(s)) ms = Date.parse(isoZoned(s));
  else if (kind === 'utc' || (kind === 'iso' && defaultUtc)) ms = WALL.test(s) ? Date.parse(s.replace(' ', 'T') + 'Z') : NaN;
  else ms = wallToMs(s, zone);
  if (!Number.isFinite(ms)) return { problem: `isn't a time (${s.slice(0, 40)})` };
  return { value: new Date(ms).toISOString() };
}

// ISO UTC from an archive -> what the target stores: Postgres takes it as it
// is; SQLite gets the form the app writes in that column.
function instantFromArchive(iso, kind, zone, driver) {
  if (iso === null || iso === undefined || iso === '') return null;
  if (driver === 'pg') return iso;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  if (kind === 'utc') return msToUtcText(ms);
  if (kind === 'local') return msToWall(ms, zone);
  if (kind === 'input') return msToWall(ms, zone, 'T', false);
  return new Date(ms).toISOString();
}

// A calendar date for the archive: 'YYYY-MM-DD' or null.
function dateToArchive(raw) {
  if (raw === null || raw === undefined) return { value: null };
  const s = String(raw).trim();
  if (!s) return { value: null };
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return { value: m[1] };
  return { problem: `isn't a date (${s.slice(0, 40)})` };
}

module.exports = {
  EXCLUDED_TABLES, MACHINE_SETTINGS, HQ_SETTINGS, HQ_STATUS_SETTINGS, INSTANTS, DATES, FK_EDGES, PHOTO_COLUMNS,
  instantToArchive, instantFromArchive, dateToArchive, wallToMs, msToWall, offsetMs,
};
