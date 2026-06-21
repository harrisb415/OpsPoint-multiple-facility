'use strict';
/**
 * Auth service — credential check, permission resolution, the /api/me payload,
 * and the forced password change. No req/res. Session mutation (regenerate/save)
 * stays in the route since it is request-bound.
 */
const crypto = require('crypto');
const repo = require('./repository');
const { hashPw, verifyPw, validatePw } = require('../../lib/crypto');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Returns one of:
//   { status: 'no_user' }          (after a constant-time dummy hash)
//   { status: 'bad_password', user }
//   { status: 'error' }            (verify threw)
//   { status: 'ok', user }
function authenticate(username, password) {
  const u = repo.getUserByUsername(username || '');
  if (!u) {
    const dummy = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2Sync('dummy', dummy, 600000, 64, 'sha512'); // constant-time-ish: don't leak user existence
    return { status: 'no_user' };
  }
  let ok = false;
  try { ok = verifyPw(password || '', u.hash, u.salt); } catch (e) { return { status: 'error' }; }
  if (!ok) return { status: 'bad_password', user: u };
  return { status: 'ok', user: u };
}

// Live permissions for a just-authenticated user (from DB, role-preset fallback).
function loginPermissions(userId, role) {
  const pu = repo.getPermissions(userId);
  return (pu && pu.permissions) ? JSON.parse(pu.permissions) : repo.rolePreset(role);
}

// Build the /api/me response from the session (+ live perms from DB).
function getMe(session) {
  const u = repo.getMePermsRole(session.userId);
  const perms = (u && u.permissions) ? JSON.parse(u.permissions) : repo.rolePreset(session.role);
  return {
    id: session.userId, username: session.username,
    displayName: session.displayName, role: session.role,
    permissions: perms, mustChangePw: !!session.must_change_pw,
  };
}

// Forced password change (caller has already verified must_change_pw state).
function forceChangePassword(userId, newPassword) {
  if (!newPassword) throw httpError(400, 'Password required');
  const err = validatePw(newPassword); if (err) throw httpError(400, err);
  const { hash, salt } = hashPw(newPassword);
  repo.setForcedPassword(userId, hash, salt);
}

module.exports = { authenticate, loginPermissions, getMe, forceChangePassword };
