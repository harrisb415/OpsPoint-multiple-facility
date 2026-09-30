'use strict';
/**
 * Users service — accounts, permission profiles, and groups. No SQL, no req/res.
 * Validation/authorization failures throw an Error carrying `.status`. The
 * last-administrator and self-demotion guards are preserved exactly; `currentUserId`
 * (the caller) is passed in for the self-protection checks.
 */
const repo = require('./repository');
const { hashPw, validatePw, verifyPw } = require('../../lib/crypto');
const quickUnlock = require('../quickunlock/service');
const invites = require('./invites');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * Array.prototype.filter cannot await. An async predicate returns a Promise,
 * and every Promise is truthy, so a bare `.filter(async …)` keeps the whole
 * array — silently. That matters here: the two permission filters below are
 * what stop an unknown permission string from being written to a user record.
 * Resolve the predicates first, then filter on the resolved flags.
 */
async function asyncFilter(arr, pred) {
  const keep = await Promise.all(arr.map((v) => pred(v)));
  return arr.filter((_, i) => keep[i]);
}

async function list() {
  const pendingInvites = await invites.pending();
  const neverUsed = new Set(await invites.unaccepted());
  return Promise.all((await repo.listUsersRaw()).map(async u => {
    let perms = null;
    try { perms = u.permissions ? JSON.parse(u.permissions) : await repo.rolePreset(u.role); } catch (e) { perms = await repo.rolePreset(u.role); }
    const groups = (await repo.getUserGroups(u.id)).map(g => ({ id: g.id, key: g.key, label: g.label }));
    return { id: u.id, username: u.username, displayName: u.display_name, role: u.role, createdAt: u.created_at, permissions: perms, is_protected: !!u.is_protected, must_change_pw: !!u.must_change_pw, groups,
      invitePendingUntil: pendingInvites[u.id] || null, inviteExpired: !pendingInvites[u.id] && neverUsed.has(u.id) };
  }));
}

// Create a user, with a temporary password or (invite: true) none: the route
// then issues an invite link for them to set their own. Returns { id,
// displayName, username, role, groupIds } for the audit.
async function create(body = {}) {
  const { username, displayName, password, role, groupIds, invite } = body;
  if (!username || !role || (!password && !invite)) throw httpError(400, 'Missing fields');
  if (password) { const err = validatePw(password); if (err) throw httpError(400, err); }
  if (await repo.findByUsername(username)) throw httpError(409, 'Username already exists');
  const { hash, salt } = password ? hashPw(password) : invites.unusablePassword();
  const validGroupIds = Array.isArray(groupIds) ? await asyncFilter(groupIds, async gid => await repo.groupExists(gid)) : [];
  const perms = validGroupIds.length > 0 ? await repo.computeGroupsPermissions(validGroupIds) : await repo.rolePreset(role);
  await repo.insertUser({ username, display_name: displayName || username, role, hash, salt, permissions: JSON.stringify(perms) });
  const newU = await repo.findByUsername(username);
  if (newU && validGroupIds.length > 0) await repo.setUserGroups(newU.id, validGroupIds);
  return { id: newU ? newU.id : null, displayName: displayName || username, username, role, groupIds: validGroupIds };
}

// Update display name / role / permissions / password with the admin guards.
// Returns a breakdown so the route can fire the exact conditional audits.
async function update(id, body = {}, { currentUserId } = {}) {
  if (!await repo.idExists(id)) throw httpError(404, 'Not found');
  const { displayName, password, role, permissions } = body;
  if (displayName) await repo.setDisplayName(id, displayName);

  let roleApplied = false;
  if (role) {
    if ((await repo.profileKeys()).includes(role)) { await repo.setRole(id, role); roleApplied = true; }
  }

  let permissionsChanged = false, perms = null;
  if (Array.isArray(permissions)) {
    const tgtU = await repo.getProtectedPerms(id);
    perms = await asyncFilter(permissions, async p => await repo.isValidPermission(p));
    const hadAdmin = tgtU && JSON.parse(tgtU.permissions || '[]').includes('admin.users');
    const willHaveAdmin = perms.includes('admin.users');
    if (hadAdmin && !willHaveAdmin && await repo.countAdmins(id) === 0) throw httpError(400, 'Cannot remove administrator access from the last administrator.');
    if (id === currentUserId && hadAdmin && !willHaveAdmin) throw httpError(400, 'You cannot remove your own administrator access.');
    await repo.setPermissions(id, JSON.stringify(perms));
    permissionsChanged = true;
  }

  let passwordChanged = false, isOwnPw = false;
  if (password) {
    const err = validatePw(password); if (err) throw httpError(400, err);
    const { hash, salt } = hashPw(password);
    isOwnPw = (id === currentUserId);
    await repo.setPassword(id, hash, salt, isOwnPw ? 0 : 1);
    await quickUnlock.revokeUser(id);   // a new password ends every phone's PIN
    passwordChanged = true;
  }

  const tgt = await repo.getNameById(id);
  const targetName = tgt ? (tgt.display_name || tgt.username) : String(id);
  return { targetName, permissionsChanged, perms, roleApplied, role, passwordChanged, isOwnPw, displayNameProvided: !!displayName };
}

// Delete a user (self / 404 / protected / last-admin guards). Returns { targetName }.
async function remove(id, { currentUserId } = {}) {
  if (id === currentUserId) throw httpError(400, 'You cannot delete your own account.');
  const u = await repo.getDeleteInfo(id);
  if (!u) throw httpError(404, 'User not found');
  if (u.is_protected) throw httpError(403, 'This is a protected account and cannot be deleted.');
  let isAdmin = false;
  try { isAdmin = JSON.parse(u.permissions || '[]').includes('admin.users'); } catch (e) { /* not admin */ }
  if (isAdmin && await repo.countAdmins(id) === 0) throw httpError(400, 'Cannot delete the last administrator account.');
  await repo.deleteUser(id);
  return { targetName: u.display_name || u.username };
}

// Toggle protected flag. Returns { targetName, protectedVal }.
async function toggleProtect(id, { currentUserId } = {}) {
  if (id === currentUserId) throw httpError(400, 'You cannot protect your own account.');
  const u = await repo.getProtectInfo(id);
  if (!u) throw httpError(404, 'User not found');
  const newVal = u.is_protected ? 0 : 1;
  await repo.setProtected(id, newVal);
  return { targetName: u.display_name || u.username, protectedVal: newVal === 1 };
}

async function getProfiles() { return await repo.getPermissionProfiles(); }

// Validate + persist permission profiles. Returns { count, keys } for audit.
async function saveProfiles(profiles) {
  if (!Array.isArray(profiles) || !profiles.length) throw httpError(400, 'Expected non-empty array');
  for (const p of profiles) {
    if (!p.key || typeof p.key !== 'string' || !p.label || !Array.isArray(p.permissions)) throw httpError(400, 'Invalid profile format');
    if (!/^[a-z][a-z0-9_]{0,49}$/.test(p.key)) throw httpError(400, 'Invalid profile key: ' + p.key);
    p.permissions = await asyncFilter(p.permissions, async x => await repo.isValidPermission(x));
  }
  await repo.setPermissionProfiles(profiles);
  return { count: profiles.length, keys: profiles.map(p => p.key) };
}

async function listGroups() {
  return Promise.all((await repo.getGroups()).map(async g => ({ ...g, memberCount: await repo.groupMemberCount(g.id) })));
}

// Create a group. Returns { id, label, key } for audit.
async function createGroup(body = {}) {
  const { key, label, permissions } = body;
  if (!key || !label) throw httpError(400, 'Key and label required');
  if (!/^[a-z][a-z0-9_]{0,49}$/.test(key)) throw httpError(400, 'Key must start with a letter and use only lowercase letters, numbers, underscores');
  if (await repo.groupByKey(key)) throw httpError(409, 'A group with that key already exists');
  const g = await repo.createGroup(key, label, Array.isArray(permissions) ? permissions : []);
  return { id: g ? g.id : null, label, key };
}

// Update a group. Returns { label, memberIds, permCount } (members get re-broadcast).
async function updateGroup(id, body = {}) {
  const g = await repo.getGroup(id);
  if (!g) throw httpError(404, 'Group not found');
  const { label, permissions } = body;
  if (!label) throw httpError(400, 'Label required');
  await repo.updateGroup(id, label, Array.isArray(permissions) ? permissions : []);
  return { label, memberIds: await repo.groupMemberIds(id), permCount: (permissions || []).length };
}

// Delete a group. Returns { label, affectedIds } (affected users get re-broadcast).
async function deleteGroup(id) {
  const g = await repo.getGroup(id);
  if (!g) throw httpError(404, 'Group not found');
  if (g.is_protected) throw httpError(403, 'This group is protected and cannot be deleted.');
  const affectedIds = await repo.deleteGroup(id);
  return { label: g.label, affectedIds: affectedIds || [] };
}

// Set a user's groups (with admin guards). Returns { targetName, groupIds }.
async function setUserGroups(id, body = {}, { currentUserId } = {}) {
  const u = await repo.getProtectInfo(id);
  if (!u) throw httpError(404, 'User not found');
  const { groupIds } = body;
  if (!Array.isArray(groupIds)) throw httpError(400, 'groupIds must be an array');
  for (const gid of groupIds) {
    if (!await repo.groupExists(gid)) throw httpError(400, 'Invalid group ID: ' + gid);
  }
  const currentPerms = await repo.getUserEffectivePermissions(id);
  const newPerms = await repo.computeGroupsPermissions(groupIds);
  const hadAdmin = currentPerms.includes('admin.users');
  const willHaveAdmin = newPerms.includes('admin.users');
  if (hadAdmin && !willHaveAdmin && await repo.countAdmins(id) === 0) throw httpError(400, 'Cannot remove administrator access from the last administrator.');
  if (id === currentUserId && hadAdmin && !willHaveAdmin) throw httpError(400, 'You cannot remove your own administrator access.');
  await repo.setUserGroups(id, groupIds);
  return { targetName: u.display_name || u.username, groupIds };
}

// Self-service password change. Returns {} on success.
async function changeOwnPassword(currentUserId, body = {}) {
  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) throw httpError(400, 'Missing fields');
  const err = validatePw(newPassword); if (err) throw httpError(400, err);
  const u = await repo.getFull(currentUserId);
  if (!u) throw httpError(404, 'User not found');
  if (!verifyPw(currentPassword, u.hash, u.salt)) throw httpError(401, 'Current password incorrect');
  const { hash, salt } = hashPw(newPassword);
  await repo.setOwnPassword(currentUserId, hash, salt);
  await quickUnlock.revokeUser(currentUserId);
}

module.exports = {
  list, create, update, remove, toggleProtect, getProfiles, saveProfiles,
  listGroups, createGroup, updateGroup, deleteGroup, setUserGroups, changeOwnPassword,
};
