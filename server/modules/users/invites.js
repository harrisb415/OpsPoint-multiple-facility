'use strict';
/**
 * One-time invite links: a new account sets its own password from a link (or
 * its QR code) instead of being handed a temporary one. Used by the setup
 * wizard's staff step and by Admin › Users.
 *
 * The link carries a random 256-bit token; the database keeps only its SHA-256
 * (user_invites), so a copy of the table opens no account. A link works once,
 * for INVITE_DAYS; issuing a new one for the same account retires the old.
 * An invited account has an unusable random password until the link is used,
 * so nobody — the admin included — ever knows it.
 */
const crypto = require('crypto');
const c = require('../../db/connection');
const { hashPw, validatePw } = require('../../lib/crypto');

const INVITE_DAYS = 7;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// A password nobody knows: what an invited account has until its link is used.
function unusablePassword() { return hashPw(crypto.randomBytes(32).toString('hex')); }

/**
 * A new invite for an account, replacing any unused one.
 * Resolves { token, expiresAt }; the caller builds the link from its origin.
 */
async function create(userId, { createdBy = null } = {}) {
  const u = await c.query1('SELECT id FROM users WHERE id=?', [userId]);
  if (!u) throw httpError(404, 'User not found');
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString();
  await c.run('DELETE FROM user_invites WHERE user_id=? AND used_at IS NULL', [userId]);
  await c.run('INSERT INTO user_invites (user_id,token_hash,created_by,created_at,expires_at) VALUES (?,?,?,?,?)',
    [userId, sha256(token), createdBy, now.toISOString(), expiresAt]);
  return { token, expiresAt };
}

// The invite a token names, if it can still be used: { id, userId, username,
// displayName, expiresAt } — or null (unknown, used or expired: one answer
// for all three, so a guess learns nothing).
async function lookup(token) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(token || ''))) return null;
  const row = await c.query1(
    `SELECT i.id, i.user_id, i.expires_at, i.used_at, u.username, u.display_name
       FROM user_invites i JOIN users u ON u.id = i.user_id WHERE i.token_hash=?`, [sha256(token)]);
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) return null;
  return { id: row.id, userId: row.user_id, username: row.username, displayName: row.display_name || row.username, expiresAt: row.expires_at };
}

/**
 * Use an invite: the account gets the password its owner chose, and the link
 * is spent. Resolves the user row (for signing in).
 */
async function accept(token, password) {
  const inv = await lookup(token);
  if (!inv) throw httpError(410, 'This invite link has expired or was already used. Ask your administrator for a new one.');
  const err = validatePw(password || ''); if (err) throw httpError(400, err);
  const { hash, salt } = hashPw(password);
  // Spend the link first, and only if it is still unspent: two tabs racing
  // with the same link can't both set a password.
  const spent = await c.run('UPDATE user_invites SET used_at=? WHERE id=? AND used_at IS NULL', [new Date().toISOString(), inv.id]);
  if (spent && spent.changes === 0) throw httpError(410, 'This invite link was already used.');
  await c.run('UPDATE users SET hash=?, salt=?, must_change_pw=0 WHERE id=?', [hash, salt, inv.userId]);
  await c.run('DELETE FROM user_invites WHERE user_id=? AND used_at IS NULL', [inv.userId]);
  await require('../quickunlock/service').revokeUser(inv.userId);
  return await c.query1('SELECT * FROM users WHERE id=?', [inv.userId]);
}

// user_id -> expiresAt of each account's usable invite.
async function pending() {
  const rows = await c.query('SELECT user_id, expires_at FROM user_invites WHERE used_at IS NULL');
  const now = Date.now(), out = {};
  for (const r of rows) if (Date.parse(r.expires_at) > now) out[r.user_id] = r.expires_at;
  return out;
}

// Accounts whose invite was never used (expired ones included): they still
// can't sign in.
async function unaccepted() {
  const rows = await c.query(
    `SELECT DISTINCT i.user_id FROM user_invites i
      WHERE i.used_at IS NULL AND NOT EXISTS (SELECT 1 FROM user_invites j WHERE j.user_id = i.user_id AND j.used_at IS NOT NULL)`);
  return rows.map((r) => r.user_id);
}

module.exports = { create, lookup, accept, pending, unaccepted, unusablePassword, INVITE_DAYS };
