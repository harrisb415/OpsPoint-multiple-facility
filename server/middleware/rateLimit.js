'use strict';
/**
 * Login rate limiting — 10 attempts per IP per 15 minutes. In-memory only;
 * resets on restart (intentional). For multi-instance cloud deploys this is a
 * seam to back with a shared store (e.g. Redis), like the session store.
 */
const _loginAttempts = {};

function loginRateCheck(ip) {
  const now = Date.now();
  if (!_loginAttempts[ip]) _loginAttempts[ip] = { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > _loginAttempts[ip].resetAt) _loginAttempts[ip] = { count: 0, resetAt: now + 15 * 60 * 1000 };
  _loginAttempts[ip].count++;
  return _loginAttempts[ip].count > 10;
}

function loginRateClear(ip) {
  delete _loginAttempts[ip];
}

module.exports = { loginRateCheck, loginRateClear };
