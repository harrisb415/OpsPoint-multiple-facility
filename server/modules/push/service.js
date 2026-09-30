'use strict';
/**
 * Push alerts — which alerts exist, who may receive each, and delivery.
 *
 * Every alert type rides on a permission staff already hold, plus
 * mobile.access, and both are re-read from the database at send time. Alert
 * text never names a resident or a room: it shows on a lock screen, and a
 * phone is not a place for PHI. The alert only says where to look.
 */
const config = require('../../config');
const settings = require('../../settings');
const db = require('../../../db');
const webpush = require('../../lib/webpush');
const repo = require('./repository');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const TYPES = [
  { key: 'due',         perm: 'reminders.view',               label: 'Wellness check due',   hint: '10 minutes before, and when overdue' },
  { key: 'walk',        perm: 'reminders.view',               label: 'Walkthrough due',      hint: '10 minutes before, and when overdue' },
  { key: 'ua',          perm: 'ua.acknowledge',               label: 'UA requests',          hint: 'When a resident is flagged for a UA' },
  { key: 'missing',     perm: 'rounds.notify_missing',        label: 'Resident not located', hint: 'Anyone missed on a wellness round' },
  { key: 'pass_late',   perm: 'passes.status',                label: 'Pass overdue',         hint: 'When a resident is not back on time' },
  { key: 'pass_ext',    perm: 'passes.notify_extended',       label: 'Pass extended',        hint: 'When someone extends a pass' },
  { key: 'consequence', perm: 'violations.notify_consequence', label: 'Consequence assigned', hint: 'Infraction outcomes to carry out' },
  { key: 'broadcast',   perm: 'broadcast.receive',            label: 'Announcements',        hint: 'When a supervisor sends one' },
];
const TYPE_KEYS = TYPES.map(t => t.key);

function typesFor(perms) {
  if (!perms.includes('mobile.access')) return [];
  return TYPES.filter(t => perms.includes(t.perm)).map(({ key, label, hint }) => ({ key, label, hint }));
}

// ── Keys (loaded once; null when push cannot run) ─────────────────────────
let _keys;          // undefined = not tried yet
let _keyError = null;
function keys() {
  if (_keys !== undefined) return _keys;
  try {
    _keys = webpush.loadKeys(config.DATA_DIR, {
      VAPID_PUBLIC_KEY: settings.get('VAPID_PUBLIC_KEY') || undefined,
      VAPID_PRIVATE_KEY: settings.get('VAPID_PRIVATE_KEY') || undefined,
    });
    // Set keys: say where they were set (the environment, a NAME_FILE, the secret store).
    if (_keys.source === 'environment') _keys.source = settings.source('VAPID_PRIVATE_KEY');
  }
  catch (e) { _keys = null; _keyError = e.message; }
  return _keys;
}
function subject() {
  return settings.get('VAPID_SUBJECT');
}
function status() {
  const k = keys();
  return k ? { enabled: true, source: k.source, generated: !!k.generated } : { enabled: false, error: _keyError };
}

// Tests swap the network call for a recorder.
let _send = (sub, message, opts) => webpush.send(sub, message, opts);
function _setSender(fn) { _send = fn || ((sub, message, opts) => webpush.send(sub, message, opts)); }

function ownerPerms(row) {
  try { return row.permissions ? JSON.parse(row.permissions) : (db.ROLE_PRESETS[row.role] || []); }
  catch (e) { return []; }
}
function prefsOf(row) {
  try { const p = JSON.parse(row.prefs || '{}'); return p && typeof p === 'object' ? p : {}; }
  catch (e) { return {}; }
}

/**
 * Send alert `type` to everyone entitled to it who has not switched it off.
 * message: { body, url, tag }. Resolves { sent, failed } and never throws, so
 * callers fire it without awaiting and an unreachable push service can't
 * fail the request that triggered it.
 */
async function notify(type, message, { excludeUserId = null } = {}) {
  const t = TYPES.find(x => x.key === type);
  if (!t) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  try {
    // Subscriptions first: with no phone subscribed there is nothing to sign,
    // so keys are never loaded (or generated) just because an event happened.
    const rows = await repo.listWithOwners();
    const k = rows.length ? keys() : null;
    if (!k) return { sent: 0, failed: 0 };
    for (const row of rows) {
      if (excludeUserId && row.user_id === excludeUserId) continue;
      const perms = ownerPerms(row);
      if (!perms.includes('mobile.access') || !perms.includes(t.perm)) continue;
      if (prefsOf(row)[type] === false) continue;
      const ok = await deliver(row, { title: 'OpsPoint', body: message.body, url: message.url || '/m/', tag: message.tag || type }, k);
      if (ok) sent++; else failed++;
    }
  } catch (e) {
    console.error('[push] notify failed:', e.message);
  }
  return { sent, failed };
}

async function deliver(row, payload, k) {
  try {
    const r = await _send(row, payload, { keys: k, subject: subject(), topic: payload.tag });
    if (r.ok) { await repo.recordOk(row.id, new Date().toISOString()); return true; }
    if (r.status === 404 || r.status === 410) await repo.removeById(row.id);   // the phone dropped it
    else await repo.recordFailure(row.id);
  } catch (e) {
    await repo.recordFailure(row.id).catch(() => {});
  }
  return false;
}

// ── Per-device API ────────────────────────────────────────────────────────
function config_(perms) {
  const k = keys();
  return { enabled: !!k, publicKey: k ? k.publicKey : null, types: typesFor(perms) };
}

function readSubscription(body) {
  const s = body && body.subscription;
  const endpoint = s && typeof s.endpoint === 'string' ? s.endpoint.trim() : '';
  const p256dh = s && s.keys && typeof s.keys.p256dh === 'string' ? s.keys.p256dh.trim() : '';
  const auth = s && s.keys && typeof s.keys.auth === 'string' ? s.keys.auth.trim() : '';
  if (!endpoint || !p256dh || !auth) throw httpError(400, 'A push subscription needs an endpoint and keys');
  if (endpoint.length > 1000 || !webpush.isAllowedEndpoint(endpoint)) throw httpError(400, 'That push service is not supported');
  const pub = webpush._b64u.dec(p256dh), sec = webpush._b64u.dec(auth);
  if (pub.length !== 65 || pub[0] !== 4 || sec.length !== 16) throw httpError(400, 'The subscription keys are malformed');
  return { endpoint, p256dh, auth };
}

async function subscribe(userId, body, { userAgent = '' } = {}) {
  if (!keys()) throw httpError(503, 'Push alerts are not set up on this server');
  const sub = readSubscription(body);
  const r = await repo.upsert({ userId, ...sub, userAgent: String(userAgent).slice(0, 300), now: new Date().toISOString() });
  return { prefs: JSON.parse(r.prefs || '{}') };
}

function endpointOf(body) {
  const e = body && typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  if (!e) throw httpError(400, 'endpoint required');
  return e;
}

async function device(userId, body) {
  const row = await repo.getByEndpoint(endpointOf(body));
  if (!row || row.user_id !== userId) return { subscribed: false, prefs: {} };
  return { subscribed: true, prefs: prefsOf(row) };
}

async function setPrefs(userId, body) {
  const endpoint = endpointOf(body);
  const incoming = body.prefs && typeof body.prefs === 'object' ? body.prefs : {};
  const prefs = {};
  for (const k of TYPE_KEYS) if (typeof incoming[k] === 'boolean') prefs[k] = incoming[k];
  if (!await repo.setPrefs(endpoint, userId, JSON.stringify(prefs))) throw httpError(404, 'This phone is not subscribed');
  return { prefs };
}

async function unsubscribe(userId, body) {
  return { removed: (await repo.removeByEndpoint(endpointOf(body), userId)) > 0 };
}

async function test(userId, body) {
  const k = keys();
  if (!k) throw httpError(503, 'Push alerts are not set up on this server');
  const row = await repo.getByEndpoint(endpointOf(body));
  if (!row || row.user_id !== userId) throw httpError(404, 'This phone is not subscribed');
  const ok = await deliver(row, { title: 'OpsPoint', body: 'Test alert: alerts are working on this phone.', url: '/m/more', tag: 'test' }, k);
  if (!ok) throw httpError(502, 'The push service did not accept the alert. Try turning alerts off and on again.');
  return { ok: true };
}

module.exports = {
  TYPES, typesFor, notify, status, config: config_, subscribe, device, setPrefs, unsubscribe, test,
  _setSender, _resetKeys: () => { _keys = undefined; _keyError = null; },
};
