'use strict';
/**
 * Auth repository — user lookups + the forced-password write for the login /
 * change-password flow. Row SQL via server/db/connection.js; ROLE_PRESETS comes
 * from db.js.
 */
const c = require('../../db/connection');
const db = require('../../../db');

function getUserByUsername(username) {
  return c.query1('SELECT * FROM users WHERE LOWER(username)=LOWER(?)', [username]);
}
function getPermissions(id) {
  return c.query1('SELECT permissions FROM users WHERE id=?', [id]);
}
function getMePermsRole(id) {
  return c.query1('SELECT permissions,role FROM users WHERE id=?', [id]);
}
function setForcedPassword(id, hash, salt) {
  c.run('UPDATE users SET hash=?,salt=?,must_change_pw=0 WHERE id=?', [hash, salt, id]);
}
function rolePreset(role) { return db.ROLE_PRESETS[role] || []; }

module.exports = { getUserByUsername, getPermissions, getMePermsRole, setForcedPassword, rolePreset };
