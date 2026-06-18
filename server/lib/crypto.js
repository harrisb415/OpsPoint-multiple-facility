'use strict';
/** Password hashing / verification / policy. Pure — no app state. */
const crypto = require('crypto');

function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { hash: crypto.pbkdf2Sync(pw, salt, 600000, 64, 'sha512').toString('hex'), salt };
}

function verifyPw(pw, hash, salt) {
  // Try 600000 first (current), fall back to 100000 (legacy hashes from before
  // the security update). Legacy hashes are re-hashed at 600000 on next change.
  try {
    const r600 = crypto.pbkdf2Sync(pw, salt, 600000, 64, 'sha512').toString('hex');
    if (crypto.timingSafeEqual(Buffer.from(r600, 'hex'), Buffer.from(hash, 'hex'))) return true;
  } catch (e) {}
  try {
    const r100 = crypto.pbkdf2Sync(pw, salt, 100000, 64, 'sha512').toString('hex');
    if (crypto.timingSafeEqual(Buffer.from(r100, 'hex'), Buffer.from(hash, 'hex'))) return true;
  } catch (e) {}
  return false;
}

function validatePw(pw) {
  if (!pw || pw.length < 8)      return 'At least 8 characters required';
  if (!/[A-Z]/.test(pw))        return 'Needs an uppercase letter';
  if (!/[a-z]/.test(pw))        return 'Needs a lowercase letter';
  if (!/[0-9]/.test(pw))        return 'Needs a number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Needs a symbol (!@#$%^&* etc.)';
  return null;
}

module.exports = { hashPw, verifyPw, validatePw };
