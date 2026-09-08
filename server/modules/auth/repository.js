'use strict';
/**
 * Auth repository — user lookups + the forced-password write for the login /
 * change-password flow. Row SQL via server/db/connection.js; ROLE_PRESETS comes
 * from db.js.
 */
const c = require('../../db/connection');
const db = require('../../../db');

async function getUserByUsername(username) {
  return await c.query1('SELECT * FROM users WHERE LOWER(username)=LOWER(?)', [username]);
}
async function getPermissions(id) {
  return await c.query1('SELECT permissions FROM users WHERE id=?', [id]);
}
async function getMePermsRole(id) {
  return await c.query1('SELECT permissions,role FROM users WHERE id=?', [id]);
}
async function setForcedPassword(id, hash, salt) {
  await c.run('UPDATE users SET hash=?,salt=?,must_change_pw=0 WHERE id=?', [hash, salt, id]);
}
function rolePreset(role) { return db.ROLE_PRESETS[role] || []; }

module.exports = { getUserByUsername, getPermissions, getMePermsRole, setForcedPassword, rolePreset };
