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
async function listUsersRaw() {
  return await c.query('SELECT id,username,display_name,role,created_at,permissions,is_protected,must_change_pw FROM users ORDER BY id');
}
async function findByUsername(username) { return await c.query1('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]); }
async function idExists(id) { return !!await c.query1('SELECT id FROM users WHERE id=?', [id]); }
async function getProtectedPerms(id) { return await c.query1('SELECT is_protected,permissions FROM users WHERE id=?', [id]); }
async function getNameById(id) { return await c.query1('SELECT username,display_name FROM users WHERE id=?', [id]); }
async function getDeleteInfo(id) { return await c.query1('SELECT username,display_name,is_protected,permissions FROM users WHERE id=?', [id]); }
async function getProtectInfo(id) { return await c.query1('SELECT id,display_name,username,is_protected FROM users WHERE id=?', [id]); }
async function getFull(id) { return await c.query1('SELECT * FROM users WHERE id=?', [id]); }

async function insertUser(f) {
  await c.run('INSERT INTO users (username,display_name,role,hash,salt,permissions,must_change_pw) VALUES (?,?,?,?,?,?,1)',
    [f.username, f.display_name, f.role, f.hash, f.salt, f.permissions]);
}
async function setDisplayName(id, v) { await c.run('UPDATE users SET display_name=? WHERE id=?', [v, id]); }
async function setRole(id, v) { await c.run('UPDATE users SET role=? WHERE id=?', [v, id]); }
async function setPermissions(id, json) { await c.run('UPDATE users SET permissions=? WHERE id=?', [json, id]); }
async function setPassword(id, hash, salt, mustChange) { await c.run('UPDATE users SET hash=?,salt=?,must_change_pw=? WHERE id=?', [hash, salt, mustChange, id]); }
async function setOwnPassword(id, hash, salt) { await c.run('UPDATE users SET hash=?,salt=? WHERE id=?', [hash, salt, id]); }
async function setProtected(id, v) { await c.run('UPDATE users SET is_protected=? WHERE id=?', [v, id]); }
async function deleteUser(id) { await c.run('DELETE FROM users WHERE id=?', [id]); }

// Count users (optionally excluding one) who still hold admin.users.
async function countAdmins(excludeUserId) {
  return (await c.query('SELECT id,permissions FROM users')).filter(u => {
    if (excludeUserId != null && u.id === excludeUserId) return false;
    try { return JSON.parse(u.permissions || '[]').includes('admin.users'); } catch (e) { return false; }
  }).length;
}

// ── groups / user_groups table (direct) ─────────────────────────────
async function groupExists(id) { return !!await c.query1('SELECT id FROM groups WHERE id=?', [id]); }
async function getGroup(id) { return await c.query1('SELECT * FROM groups WHERE id=?', [id]); }
async function groupByKey(key) { return await c.query1('SELECT id FROM groups WHERE key=?', [key]); }
async function groupMemberCount(id) { const r = await c.query1('SELECT COUNT(*) as c FROM user_groups WHERE group_id=?', [id]); return r ? r.c : 0; }
async function groupMemberIds(id) { return (await c.query('SELECT user_id FROM user_groups WHERE group_id=?', [id])).map(r => r.user_id); }

// ── delegated to db.js (transitional) ───────────────────────────────
async function getUserGroups(id) { return await db.getUserGroups(id); }
async function getGroups() { return await db.getGroups(); }
async function computeGroupsPermissions(ids) { return await db.computeGroupsPermissions(ids); }
async function setUserGroups(id, ids) { return await db.setUserGroups(id, ids); }
async function getUserEffectivePermissions(id) { return await db.getUserEffectivePermissions(id); }
async function getPermissionProfiles() { return await db.getPermissionProfiles(); }
async function setPermissionProfiles(p) { return await db.setPermissionProfiles(p); }
async function createGroup(k, l, p) { return await db.createGroup(k, l, p); }
async function updateGroup(id, l, p) { return await db.updateGroup(id, l, p); }
async function deleteGroup(id) { return await db.deleteGroup(id); }

// ── permission catalog predicates ───────────────────────────────────
function isValidPermission(p) { return db.PERMISSIONS.includes(p); }
function rolePreset(role) { return db.ROLE_PRESETS[role] || []; }
async function profileKeys() { return (await db.getPermissionProfiles()).map(p => p.key); }

module.exports = {
  listUsersRaw, findByUsername, idExists, getProtectedPerms, getNameById, getDeleteInfo,
  getProtectInfo, getFull, insertUser, setDisplayName, setRole, setPermissions, setPassword,
  setOwnPassword, setProtected, deleteUser, countAdmins,
  groupExists, getGroup, groupByKey, groupMemberCount, groupMemberIds,
  getUserGroups, getGroups, computeGroupsPermissions, setUserGroups, getUserEffectivePermissions,
  getPermissionProfiles, setPermissionProfiles, createGroup, updateGroup, deleteGroup,
  isValidPermission, rolePreset, profileKeys,
};
