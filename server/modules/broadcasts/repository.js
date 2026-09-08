'use strict';
/**
 * Broadcasts repository — the staff-announcement helpers still live in db.js
 * (getBroadcasts/createBroadcast); they are delegated here for now and fold in
 * when fully migrated. Used nowhere else.
 */
const db = require('../../../db');

async function recent(hours) { return await db.getBroadcasts(hours); }
async function create(senderId, senderName, message) { return await db.createBroadcast(senderId, senderName, message); }

module.exports = { recent, create };
