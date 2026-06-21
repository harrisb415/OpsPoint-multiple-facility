'use strict';
/**
 * Users repository — SQL for accounts, permission profiles, and groups.
 * User/group/user_group row SQL goes through server/db/connection.js. The
 * complex permission-group helpers (compute/effective perms, profile + group
 * CRUD with permission recompute) still live in db.js and are delegated here;
 * the PERMISSIONS / ROLE_PRESETS catalogs are exposed via small predicates so
 * the service stays storage-agnostic.
 */
const c = require('../../db/connection');
const db = require('../../../db');

// ── users table ─────────────────────────────────────────────────────
function listUsersRaw() {
  return c.query('SELECT id,username,display_name,role,created_at,permissions,is_protected,must_change_pw FROM users ORDER BY id');
}
function findByUsername(username) { return c.query1('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]); }
function idExists(id) { return !!c.query1('SELECT id FROM users WHERE id=?', [id]); }
function getProtectedPerms(id) { return c.query1('SELECT is_protected,permissions FROM users WHERE id=?', [id]); }
function getNameById(id) { return c.query1('SELECT username,display_name FROM users WHERE id=?', [id]); }
function getDeleteInfo(id) { return c.query1('SELECT username,display_name,is_protected,permissions FROM users WHERE id=?', [id]); }
function getProtectInfo(id) { return c.query1('SELECT id,display_name,username,is_protected FROM users WHERE id=?', [id]); }
function getFull(id) { return c.query1('SELECT * FROM users WHERE id=?', [id]); }

function insertUser(f) {
  c.run('INSERT INTO users (username,display_name,role,hash,salt,permissions,must_change_pw) VALUES (?,?,?,?,?,?,1)',
    [f.username, f.display_name, f.role, f.hash, f.salt, f.permissions]);
}
function setDisplayName(id, v) { c.run('UPDATE users SET display_name=? WHERE id=?', [v, id]); }
function setRole(id, v) { c.run('UPDATE users SET role=? WHERE id=?', [v, id]); }
function setPermissions(id, json) { c.run('UPDATE users SET permissions=? WHERE id=?', [json, id]); }
function setPassword(id, hash, salt, mustChange) { c.run('UPDATE users SET hash=?,salt=?,must_change_pw=? WHERE id=?', [hash, salt, mustChange, id]); }
function setOwnPassword(id, hash, salt) { c.run('UPDATE users SET hash=?,salt=? WHERE id=?', [hash, salt, id]); }
function setProtected(id, v) { c.run('UPDATE users SET is_protected=? WHERE id=?', [v, id]); }
function deleteUser(id) { c.run('DELETE FROM users WHERE id=?', [id]); }

// Count users (optionally excluding one) who still hold admin.users.
function countAdmins(excludeUserId) {
  return c.query('SELECT id,permissions FROM users').filter(u => {
    if (excludeUserId != null && u.id === excludeUserId) return false;
    try { return JSON.parse(u.permissions || '[]').includes('admin.users'); } catch (e) { return false; }
  }).length;
}

// ── groups / user_groups table (direct) ─────────────────────────────
function groupExists(id) { return !!c.query1('SELECT id FROM groups WHERE id=?', [id]); }
function getGroup(id) { return c.query1('SELECT * FROM groups WHERE id=?', [id]); }
function groupByKey(key) { return c.query1('SELECT id FROM groups WHERE key=?', [key]); }
function groupMemberCount(id) { const r = c.query1('SELECT COUNT(*) as c FROM user_groups WHERE group_id=?', [id]); return r ? r.c : 0; }
function groupMemberIds(id) { return c.query('SELECT user_id FROM user_groups WHERE group_id=?', [id]).map(r => r.user_id); }

// ── delegated to db.js (transitional) ───────────────────────────────
function getUserGroups(id) { return db.getUserGroups(id); }
function getGroups() { return db.getGroups(); }
function computeGroupsPermissions(ids) { return db.computeGroupsPermissions(ids); }
function setUserGroups(id, ids) { return db.setUserGroups(id, ids); }
function getUserEffectivePermissions(id) { return db.getUserEffectivePermissions(id); }
function getPermissionProfiles() { return db.getPermissionProfiles(); }
function setPermissionProfiles(p) { return db.setPermissionProfiles(p); }
function createGroup(k, l, p) { return db.createGroup(k, l, p); }
function updateGroup(id, l, p) { return db.updateGroup(id, l, p); }
function deleteGroup(id) { return db.deleteGroup(id); }

// ── permission catalog predicates ───────────────────────────────────
function isValidPermission(p) { return db.PERMISSIONS.includes(p); }
function rolePreset(role) { return db.ROLE_PRESETS[role] || []; }
function profileKeys() { return db.getPermissionProfiles().map(p => p.key); }

module.exports = {
  listUsersRaw, findByUsername, idExists, getProtectedPerms, getNameById, getDeleteInfo,
  getProtectInfo, getFull, insertUser, setDisplayName, setRole, setPermissions, setPassword,
  setOwnPassword, setProtected, deleteUser, countAdmins,
  groupExists, getGroup, groupByKey, groupMemberCount, groupMemberIds,
  getUserGroups, getGroups, computeGroupsPermissions, setUserGroups, getUserEffectivePermissions,
  getPermissionProfiles, setPermissionProfiles, createGroup, updateGroup, deleteGroup,
  isValidPermission, rolePreset, profileKeys,
};
