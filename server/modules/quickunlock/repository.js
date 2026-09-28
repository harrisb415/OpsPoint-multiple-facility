'use strict';
/** Quick-unlock repository — SQL for device_pins (one row per phone with a PIN). */
const c = require('../../db/connection');

async function create({ userId, tokenHash, pinHash, pinSalt, userAgent, now, expiresAt }) {
  await c.run(
    `INSERT INTO device_pins (user_id,token_hash,pin_hash,pin_salt,user_agent,created_at,expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    [userId, tokenHash, pinHash, pinSalt, userAgent, now, expiresAt]);
}

// The row for a device token, with its owner as the login needs them.
async function byToken(tokenHash) {
  return await c.query1(
    `SELECT d.id, d.user_id, d.pin_hash, d.pin_salt, d.failures, d.expires_at,
            u.username, u.display_name, u.role, u.permissions, u.must_change_pw
       FROM device_pins d JOIN users u ON u.id = d.user_id
      WHERE d.token_hash=?`, [tokenHash]);
}

// Count a wrong PIN; resolves the new total.
async function recordFailure(id) {
  await c.run('UPDATE device_pins SET failures=failures+1 WHERE id=?', [id]);
  const r = await c.query1('SELECT failures FROM device_pins WHERE id=?', [id]);
  return r ? r.failures : 0;
}

async function recordSuccess(id, now, expiresAt) {
  await c.run('UPDATE device_pins SET failures=0, last_used_at=?, expires_at=? WHERE id=?', [now, expiresAt, id]);
}

async function removeById(id) {
  await c.run('DELETE FROM device_pins WHERE id=?', [id]);
}

async function removeByToken(tokenHash) {
  const r = await c.run('DELETE FROM device_pins WHERE token_hash=?', [tokenHash]);
  return r.changes;
}

// Every phone's PIN for a user — on a password change or reset.
async function removeForUser(userId) {
  await c.run('DELETE FROM device_pins WHERE user_id=?', [userId]);
}

module.exports = { create, byToken, recordFailure, recordSuccess, removeById, removeByToken, removeForUser };
