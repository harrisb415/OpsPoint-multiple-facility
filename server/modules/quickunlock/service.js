'use strict';
/**
 * Quick unlock: after the idle sign-out, a phone signs back in with a 6-digit
 * PIN instead of the full password.
 *
 * A PIN is only half of it. Setting one gives the phone a random 256-bit token,
 * kept in an httpOnly cookie that page scripts can't read, and only its SHA-256
 * is stored. Unlocking needs that token AND the PIN, so a PIN learned by
 * looking over a shoulder is useless without the phone, and a copy of the
 * table (hashes only) signs no one in.
 *
 * Five wrong PINs delete the device's row, so a stolen phone gets five guesses
 * out of a million. It also ends when the user signs out, changes or has their
 * password reset, loses mobile.access, or leaves it unused for 30 days.
 */
const crypto = require('crypto');
const db = require('../../../db');
const repo = require('./repository');

const TTL_MS = 30 * 86400000;
const MAX_FAILURES = 5;
const PIN_ITERATIONS = 100000;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const hashPin = (pin, salt) => crypto.pbkdf2Sync(String(pin), salt, PIN_ITERATIONS, 32, 'sha256').toString('hex');

// Six digits, and not one anyone would try first.
function checkPin(pin) {
  const p = String(pin || '');
  if (!/^\d{6}$/.test(p)) throw httpError(400, 'The PIN must be exactly 6 digits');
  const ascending = '0123456789012345', descending = '9876543210987654';
  if (/^(\d)\1{5}$/.test(p) || ascending.includes(p) || descending.includes(p) || /^(\d\d)\1\1$/.test(p) || /^(\d{3})\1$/.test(p)) {
    throw httpError(400, 'That PIN is too easy to guess. Pick six digits without a pattern.');
  }
  return p;
}

function ownerPerms(row) {
  try { return row.permissions ? JSON.parse(row.permissions) : (db.ROLE_PRESETS[row.role] || []); }
  catch (e) { return []; }
}

// Create this phone's credential. Resolves { token, expiresAt } for the cookie.
async function setup(userId, pin, { userAgent = '', replaceToken = null } = {}) {
  const p = checkPin(pin);
  if (replaceToken) await repo.removeByToken(hashToken(replaceToken));
  const token = crypto.randomBytes(32).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
  await repo.create({
    userId, tokenHash: hashToken(token), pinHash: hashPin(p, salt), pinSalt: salt,
    userAgent: String(userAgent).slice(0, 300), now: now.toISOString(), expiresAt,
  });
  return { token, expiresAt };
}

// Whether this phone can unlock with a PIN, and whose it is.
async function status(token) {
  if (!token) return { available: false };
  const row = await repo.byToken(hashToken(token));
  if (!row) return { available: false };
  if (Date.parse(row.expires_at) <= Date.now()) { await repo.removeById(row.id); return { available: false } }
  return { available: true, name: row.display_name || row.username, userId: row.user_id };
}

/**
 * Check a PIN. Resolves one of:
 *   { status: 'ok', user, expiresAt }       — sign them in; the credential slides 30 days
 *   { status: 'bad_pin', left }             — wrong PIN, `left` tries remain
 *   { status: 'locked' }                    — that was the fifth; the credential is gone
 *   { status: 'gone' }                      — no credential, expired, or mobile.access revoked
 */
async function unlock(token, pin) {
  if (!token) return { status: 'gone' };
  const row = await repo.byToken(hashToken(token));
  if (!row) return { status: 'gone' };
  if (Date.parse(row.expires_at) <= Date.now() || !ownerPerms(row).includes('mobile.access')) {
    await repo.removeById(row.id);
    return { status: 'gone' };
  }
  const given = Buffer.from(hashPin(String(pin || ''), row.pin_salt), 'hex');
  const stored = Buffer.from(row.pin_hash, 'hex');
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
    const failures = await repo.recordFailure(row.id);
    if (failures >= MAX_FAILURES) { await repo.removeById(row.id); return { status: 'locked', userId: row.user_id, username: row.username } }
    return { status: 'bad_pin', left: MAX_FAILURES - failures, userId: row.user_id, username: row.username };
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
  await repo.recordSuccess(row.id, now.toISOString(), expiresAt);
  return {
    status: 'ok',
    expiresAt,
    user: { id: row.user_id, username: row.username, display_name: row.display_name, role: row.role, must_change_pw: row.must_change_pw },
  };
}

async function remove(token) {
  return token ? (await repo.removeByToken(hashToken(token))) > 0 : false;
}

// Called wherever a password changes: every phone's PIN stops working.
async function revokeUser(userId) {
  await repo.removeForUser(userId);
}

module.exports = { setup, status, unlock, remove, revokeUser, _checkPin: checkPin, MAX_FAILURES, TTL_MS };
