'use strict';
/**
 * First-run setup in the browser (deployment plan phase 6).
 *
 * A new install has no accounts. Instead of printing passwords, OpsPoint
 * prints a one-time setup code; whoever has it opens /setup and creates the
 * first admin, then walks the remaining steps — each saved as it goes,
 * skippable, resumable — and finishes. The state is the `setup` setting:
 *
 *   { code_hash, code_salt, code_created, code_expires,   the one-time code
 *     admin_id, started_at, finished_at,                   who, when
 *     steps: { <id>: 'done' | 'skipped' },
 *     compliance, checklist_dismissed_at, legacy }
 *
 * and it is in one of three states:
 *   'code'    no account exists yet: only the code can create the first admin
 *   'wizard'  that admin exists and setup isn't finished: they (or anyone with
 *             admin.settings) walk the remaining steps
 *   'done'    finished — or an install that had accounts before this existed
 *             (legacy). /setup is gone for good.
 *
 * The steps save their data through the app's own endpoints (facility
 * settings, rooms, users…); this module keeps the code, the step marks, the
 * finish and the checklist shown on the dashboard afterwards.
 */
const crypto = require('crypto');
const c = require('../../db/connection');
const db = require('../../../db');
const settings = require('../../settings');
const { PROFILES } = require('../../settings/schema');
const { hashPw, verifyPw, validatePw } = require('../../lib/crypto');

const CODE_HOURS = 24;
// No 0/O, 1/I/L: read aloud or off a phone, a code can't be misread.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ── The steps ───────────────────────────────────────────────────────────────
// `when(ctx)` says whether a step applies to this install (the wizard shows
// only those); `optional` ones are left out of the checklist when skipped.
const STEPS = [
  { id: 'account', title: 'Admin account' },
  { id: 'facility', title: 'Facility' },
  { id: 'shifts', title: 'Shifts and reminders' },
  { id: 'rooms', title: 'Rooms and residents' },
  { id: 'care', title: 'Care defaults' },
  { id: 'features', title: 'Features' },
  { id: 'staff', title: 'Staff' },
  { id: 'security', title: 'Security and records' },
  { id: 'phone', title: 'Phone app' },
  { id: 'hq', title: 'HQ', optional: true },
  { id: 'review', title: 'Review and finish' },
];
const STEP_IDS = STEPS.map((s) => s.id);

// ── State ───────────────────────────────────────────────────────────────────
let _done = false;       // once finished, never open again: skip the database
async function readState() { return (await db.getSetting('setup', null)) || null; }
async function writeState(st) { await db.setSetting('setup', st); await db.save(); }
async function userCount() { const r = await c.query1('SELECT COUNT(*) AS n FROM users'); return Number(r && r.n) || 0; }

// 'code' | 'wizard' | 'done', and the stored state.
async function current() {
  if (_done) return { state: 'done', st: null };
  const st = await readState();
  if (st && st.finished_at) { _done = true; return { state: 'done', st }; }
  if (st && st.admin_id) return { state: 'wizard', st };
  if (await userCount() > 0) return { state: 'done', st };        // accounts made some other way
  return { state: 'code', st: st || {} };
}

/**
 * At every start: an install that already has accounts but no setup record
 * (every install before this existed) is marked done; a new one gets a code
 * if it has none that is still good. Resolves { code, expiresAt } when it
 * made one (for the console), else null.
 */
async function atStart() {
  const st = await readState();
  if (st && (st.finished_at || st.admin_id)) return null;
  if (await userCount() > 0) {
    if (!st) await writeState({ finished_at: new Date().toISOString(), legacy: true });
    return null;
  }
  if (st && st.code_hash && Date.parse(st.code_expires) > Date.now()) return { existing: true, expiresAt: st.code_expires };
  return newCode();
}

// A new one-time code (replacing any), valid CODE_HOURS. Only while no
// account exists. Resolves { code, expiresAt }.
async function newCode() {
  const { state, st } = await current();
  if (state !== 'code') throw httpError(409, state === 'done' ? 'Setup is finished.' : 'The admin account already exists: sign in to finish setup.');
  const bytes = crypto.randomBytes(8);
  let raw = '';
  for (const b of bytes) raw += CODE_ALPHABET[b % CODE_ALPHABET.length];
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const { hash, salt } = hashPw(raw);
  const now = new Date(), expiresAt = new Date(now.getTime() + CODE_HOURS * 3600000).toISOString();
  await writeState({ ...st, code_hash: hash, code_salt: salt, code_created: now.toISOString(), code_expires: expiresAt });
  return { code, expiresAt };
}
const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

// ── What the page needs ─────────────────────────────────────────────────────
function profileInfo() {
  const p = settings.profile();
  return { name: p.name, kind: PROFILES[p.name].kind, label: PROFILES[p.name].label };
}

// For anyone (no session): only which state, and whether the code expired.
// The rest is for a signed-in admin.
async function status({ admin = false, origin = null } = {}) {
  const { state, st } = await current();
  if (state === 'done') return { state };
  if (state === 'code') {
    return { state, expired: !st.code_hash || !(Date.parse(st.code_expires) > Date.now()), codeHours: CODE_HOURS };
  }
  if (!admin) return { state, signIn: true };
  const tz = settings.timeZone();
  return {
    state,
    profile: profileInfo(),
    timeZone: { name: tz.name, source: tz.source, explicit: tz.explicit },
    steps: STEPS.map((s) => ({ id: s.id, title: s.title, optional: !!s.optional, state: (st.steps || {})[s.id] || null })),
    compliance: st.compliance || null,
    security: await securityPlan(),
    phoneUrl: origin ? `${origin}/m` : null,          // what the phone app's QR code opens
  };
}

// The "Security and records" step differs by target (the plan's table).
async function securityPlan() {
  const prof = profileInfo();
  const sqlite = !c.isPg, encrypt = !!settings.get('OPSPOINT_ENCRYPT');
  let dbKey = null;
  if (sqlite && encrypt) {
    const k = require('../../db/dbcrypt').currentKey(settings.get('OPSPOINT_DB'));
    const confirmed = await db.getSetting('dbkey_backup_confirmed', null);
    const store = settings.storeInfo();
    dbKey = {
      fromSetting: !!(k && k.fromSetting), inStore: !!(k && k.fromSetting && store.loaded && k.source === store.label),
      source: k ? k.source : null, downloadable: !!(k && !k.fromSetting),
      confirmed: !!(k && confirmed && confirmed.fp === k.fingerprint),
    };
  }
  const backups = settings.get('OPSPOINT_BACKUPS') === 'provider' || prof.kind === 'managed'
    ? { kind: 'provider' }
    : sqlite ? { kind: 'folder', dir: await require('../../lib/backup').dirFor(db), set: !!(await db.getSetting('backup_dir', null)) }
      : { kind: prof.kind === 'container' ? 'volume' : 'external' };
  return {
    profile: prof,
    database: sqlite ? 'sqlite' : 'pg',
    dbKey,
    backups,
    https: prof.kind === 'managed' ? 'domain' : prof.kind === 'container' ? 'proxy' : 'certificate',
    tls: !!require('../../secrets').tlsFiles(settings.get('OPSPOINT_DATA')),
    signIn: 'local',
    updates: settings.get('OPSPOINT_UPDATES') === 'in-app' ? { auto: [true, 'true'].includes(await db.getSetting('update_auto_check', true)) } : null,
    compliance: prof.kind === 'managed' ? 'baa' : 'offsite',
  };
}

// ── Creating the first admin (the code) ─────────────────────────────────────
/**
 * Resolves the new user row. Throws 403 for a wrong code, 410 for an expired
 * one, 409 once an account exists.
 */
async function createAdmin({ code, displayName, username, password } = {}) {
  const { state, st } = await current();
  if (state !== 'code') throw httpError(409, state === 'done' ? 'Setup is finished.' : 'The admin account already exists: sign in to finish setup.');
  if (!st.code_hash || !(Date.parse(st.code_expires) > Date.now())) {
    throw httpError(410, `The setup code has expired (codes last ${CODE_HOURS} hours). Make a new one with \`node server/cli/opspoint.js setup-code\` on the server, or restart OpsPoint.`);
  }
  let ok = false;
  try { ok = verifyPw(normalizeCode(code), st.code_hash, st.code_salt); } catch (e) { ok = false; }
  if (!ok) throw httpError(403, "That isn't the setup code. It is in the installer's last screen, or the server's log.");
  const uname = String(username || '').trim(), name = String(displayName || '').trim() || uname;
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(uname)) throw httpError(400, 'Username: 2 to 40 letters, numbers, dots, dashes or underscores.');
  if (name.length > 80) throw httpError(400, 'Name: at most 80 characters.');
  const err = validatePw(password || ''); if (err) throw httpError(400, `Password: ${err}.`);
  const { hash, salt } = hashPw(password);
  await c.run(`INSERT INTO users (username,display_name,role,hash,salt,must_change_pw,permissions,is_protected) VALUES (?,?,?,?,?,0,?,1)`,
    [uname, name, 'admin', hash, salt, JSON.stringify(db.ROLE_PRESETS.admin)]);
  const u = await c.query1('SELECT * FROM users WHERE LOWER(username)=LOWER(?)', [uname]);
  const now = new Date().toISOString();
  const next = { ...st, admin_id: u.id, started_at: now, steps: { ...(st.steps || {}), account: 'done' } };
  delete next.code_hash; delete next.code_salt;                    // spent
  await writeState(next);
  return u;
}

// ── The steps and the finish ────────────────────────────────────────────────
async function markStep(id, mark) {
  if (!STEP_IDS.includes(id) || id === 'account' || id === 'review') throw httpError(400, 'No such step.');
  if (mark !== 'done' && mark !== 'skipped') throw httpError(400, 'A step is done or skipped.');
  const { state, st } = await current();
  if (state !== 'wizard') throw httpError(409, 'Setup is not in progress.');
  await writeState({ ...st, steps: { ...(st.steps || {}), [id]: mark } });
  return { id, mark };
}

/**
 * Finish: the compliance tick is required (the provider's BAA is signed, or
 * backups leave the building), the health check runs, and /setup locks.
 * Resolves { results } of the check.
 */
async function finish({ compliance, runDoctor, by }) {
  const { state, st } = await current();
  if (state !== 'wizard') throw httpError(409, 'Setup is not in progress.');
  const need = (await securityPlan()).compliance;
  if (!compliance || compliance !== need) {
    throw httpError(400, need === 'baa'
      ? "Tick that your provider's Business Associate Agreement is signed before finishing."
      : 'Tick that backups are copied somewhere outside the building before finishing.');
  }
  const r = runDoctor ? await runDoctor() : null;
  const steps = { ...(st.steps || {}) };
  for (const s of STEPS) if (!steps[s.id] && s.id !== 'review') steps[s.id] = 'skipped';
  steps.review = 'done';
  await writeState({ ...st, steps, compliance: { kind: need, by, at: new Date().toISOString() }, finished_at: new Date().toISOString() });
  _done = true;
  return r;
}

// ── Rooms, in bulk ──────────────────────────────────────────────────────────
// The rooms step: "Floor 2: 201–220" or a CSV of rooms and residents, in one
// call. Each row: { room, name? }. Rooms that exist already are left alone.
async function addRooms(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw httpError(400, 'No rooms to add.');
  if (rows.length > 500) throw httpError(400, 'At most 500 rooms at a time.');
  const facility = require('../facility/service');
  const added = [], existing = [], problems = [];
  for (const [i, r] of rows.entries()) {
    const room = String((r && r.room) || '').trim(), name = String((r && r.name) || '').trim();
    if (!room || room.length > 20) { problems.push(`Row ${i + 1}: a room number of 1 to 20 characters.`); continue; }
    if (name.length > 120) { problems.push(`Row ${i + 1}: the name is too long.`); continue; }
    try { await facility.createRoom({ room, name: name || undefined }); added.push(room); }
    catch (e) { if (e.status === 409) existing.push(room); else problems.push(`Room ${room}: ${e.message}`); }
  }
  return { added, existing, problems };
}

// ── After setup: the checklist card ─────────────────────────────────────────
/**
 * What was skipped or still needs doing, for the dashboard card. Only for an
 * install set up with the wizard, until someone dismisses the card.
 * items: [{ id, text }]
 */
async function checklist({ latestHealth } = {}) {
  const { state, st } = await current();
  const stored = st || await readState();
  if (state !== 'done' || !stored || stored.legacy || !stored.finished_at || stored.checklist_dismissed_at) return { show: false, items: [] };
  const items = [];
  const skipped = (id) => (stored.steps || {})[id] === 'skipped';
  const plan = await securityPlan();
  if (plan.backups.kind === 'folder' && !plan.backups.set) items.push({ id: 'backups', text: 'No backup destination set: backups go to a folder on the database\'s own drive.' });
  if (plan.dbKey && !plan.dbKey.inStore && !plan.dbKey.confirmed) items.push({ id: 'dbkey', text: "The database key isn't confirmed as stored somewhere else." });
  const unaccepted = await require('../users/invites').unaccepted();
  if (unaccepted.length) items.push({ id: 'invites', text: `${unaccepted.length} staff ${unaccepted.length === 1 ? "hasn't" : "haven't"} accepted ${unaccepted.length === 1 ? 'an invite' : 'invites'}.` });
  const rooms = await c.query1("SELECT COUNT(*) AS n FROM clients WHERE is_active=1");
  if (!Number(rooms && rooms.n)) items.push({ id: 'rooms', text: 'No rooms yet.' });
  if (skipped('staff') && await userCount() < 2) items.push({ id: 'staff', text: 'No staff accounts yet.' });
  if (skipped('phone')) items.push({ id: 'phone', text: 'No phone set up yet for the mobile app and alerts.' });
  for (const id of ['facility', 'shifts', 'care', 'features']) {
    if (skipped(id)) items.push({ id, text: `${STEPS.find((s) => s.id === id).title}: skipped, so the defaults apply.` });
  }
  if (latestHealth) {
    const failing = latestHealth.results.filter((x) => x.status === 'fail');
    if (failing.length) items.push({ id: 'health', text: `The health check has ${failing.length} failing: ${failing.map((x) => x.label.toLowerCase()).join(', ')}.` });
  }
  return { show: items.length > 0, items };
}

async function dismissChecklist() {
  const st = await readState();
  if (!st || !st.finished_at) throw httpError(409, 'Setup is not finished.');
  await writeState({ ...st, checklist_dismissed_at: new Date().toISOString() });
}

// For tests: forget the cached "done".
function _reset() { _done = false; }

module.exports = {
  STEPS, CODE_HOURS, current, atStart, newCode, status, securityPlan, createAdmin, markStep, finish,
  addRooms, checklist, dismissChecklist, normalizeCode, _reset,
};
