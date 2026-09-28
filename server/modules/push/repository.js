'use strict';
/**
 * Push repository — SQL for push_subscriptions: one row per phone (browser
 * push endpoint), owned by the user signed in when it subscribed, carrying
 * that phone's alert toggles as JSON.
 */
const c = require('../../db/connection');

async function getByEndpoint(endpoint) {
  return await c.query1('SELECT * FROM push_subscriptions WHERE endpoint=?', [endpoint]);
}

// Insert, or take over an existing endpoint. A phone that changes hands keeps
// its endpoint but not the previous owner's toggles.
async function upsert({ userId, endpoint, p256dh, auth, userAgent, now }) {
  const cur = await getByEndpoint(endpoint);
  if (cur) {
    const prefs = cur.user_id === userId ? cur.prefs : '{}';
    await c.run('UPDATE push_subscriptions SET user_id=?, p256dh=?, auth=?, user_agent=?, prefs=?, failures=0 WHERE id=?',
      [userId, p256dh, auth, userAgent, prefs, cur.id]);
    return { id: cur.id, prefs };
  }
  const r = await c.run(
    'INSERT INTO push_subscriptions (user_id,endpoint,p256dh,auth,user_agent,prefs,created_at) VALUES (?,?,?,?,?,?,?)',
    [userId, endpoint, p256dh, auth, userAgent, '{}', now]);
  return { id: r.lastInsertRowid, prefs: '{}' };
}

async function setPrefs(endpoint, userId, prefsJson) {
  const r = await c.run('UPDATE push_subscriptions SET prefs=? WHERE endpoint=? AND user_id=?', [prefsJson, endpoint, userId]);
  return r.changes;
}

async function removeByEndpoint(endpoint, userId) {
  const r = await c.run('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?', [endpoint, userId]);
  return r.changes;
}

async function removeById(id) {
  await c.run('DELETE FROM push_subscriptions WHERE id=?', [id]);
}

// Every subscription with its owner's CURRENT permissions, re-read on each
// send so a revoked permission stops alerts at once.
async function listWithOwners() {
  return await c.query(
    `SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth, s.prefs, u.permissions, u.role
       FROM push_subscriptions s JOIN users u ON u.id = s.user_id`);
}

async function recordOk(id, now) {
  await c.run('UPDATE push_subscriptions SET last_ok_at=?, failures=0 WHERE id=?', [now, id]);
}

// Counts a failed delivery; a subscription failing five times running is dropped.
async function recordFailure(id) {
  await c.run('UPDATE push_subscriptions SET failures=failures+1 WHERE id=?', [id]);
  await c.run('DELETE FROM push_subscriptions WHERE id=? AND failures>=5', [id]);
}

module.exports = { getByEndpoint, upsert, setPrefs, removeByEndpoint, removeById, listWithOwners, recordOk, recordFailure };
