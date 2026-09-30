'use strict';
/**
 * Setup routes — HTTP layer for first-run setup (./service.js).
 *
 *   GET  /api/setup/status              anyone: which state; an admin: the steps
 *   POST /api/setup/account             the code + the first admin (no session yet)
 *   PUT  /api/setup/steps/:id           a step done or skipped
 *   POST /api/setup/rooms               rooms (and residents) in bulk
 *   PUT  /api/setup/backup-dir          where scheduled SQLite backups go
 *   PUT  /api/setup/updates             automatic update checks on or off
 *   POST /api/setup/finish              the compliance tick, the health check, done
 *   GET  /api/setup/checklist           the dashboard card afterwards
 *   POST /api/setup/checklist/dismiss
 *
 * While no account exists, / and /login lead to /setup. Every step is in the
 * audit log (setup.*), besides whatever the step's own endpoints record.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { requireAuth, requirePermission, userPerms } = require('../../middleware/auth');
const { csrfCheck, originHost } = require('../../middleware/csrf');
const { loginRateCheck } = require('../../middleware/rateLimit');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const { establishSession } = require('../auth/session');
const service = require('./service');

const who = (req) => req.session.displayName || req.session.username || 'admin';
const fail = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Setup failed.' });

// doctor: () => the server's health check (it is made after the routes).
function register(app, { doctor: doctorOf = () => null } = {}) {
  // A fresh install's first visit lands on the setup page.
  app.get(['/', '/login'], async (req, res, next) => {
    try { if ((await service.current()).state === 'code') return res.redirect('/setup'); } catch (e) { /* carry on */ }
    next();
  });

  app.get('/api/setup/status', async (req, res) => {
    try {
      const perms = await userPerms(req);
      res.json(await service.status({ admin: perms.includes('admin.settings'), origin: require('../../lib/net').reachableOrigin(req) }));
    } catch (e) { fail(res, e); }
  });

  // The first admin, with the one-time code. No session yet: the Origin is
  // checked as /api/login checks it, and guesses share its rate limit.
  app.post('/api/setup/account', express.json(), async (req, res) => {
    const o = req.headers.origin;
    if (o && originHost(o) !== req.headers.host) return res.status(403).json({ error: 'Forbidden' });
    if (loginRateCheck(req.ip || 'unknown')) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes.' });
    const b = req.body || {};
    try {
      const u = await service.createAdmin(b);
      await establishSession(req, u);
      const actor = { actorId: u.id, actorName: u.display_name || u.username };
      await audit(req, 'setup.account', 'user', u.id, u.display_name || u.username, { username: u.username }, actor);
      res.json({ ok: true });
    } catch (e) {
      if (e.status === 403 || e.status === 410) {
        await audit(req, 'setup.code_refused', 'system', null, 'Setup', { reason: e.status === 410 ? 'expired' : 'wrong code' }, { actorId: null, actorName: String(b.username || '?').slice(0, 40) });
      }
      fail(res, e);
    }
  });

  app.put('/api/setup/steps/:id', requireAuth, csrfCheck, requirePermission('admin.settings'), async (req, res) => {
    try {
      const r = await service.markStep(req.params.id, (req.body || {}).state);
      await audit(req, 'setup.step', 'system', null, 'Setup', { step: r.id, state: r.mark, by: who(req) });
      res.json({ ok: true, status: await service.status({ admin: true, origin: require('../../lib/net').reachableOrigin(req) }) });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/setup/rooms', requireAuth, csrfCheck, requirePermission('facility.manage'), async (req, res) => {
    try {
      if ((await service.current()).state !== 'wizard') return res.status(409).json({ error: 'Setup is not in progress.' });
      const r = await service.addRooms((req.body || {}).rooms);
      await audit(req, 'setup.rooms', 'facility', null, 'Rooms', { added: r.added.length, existing: r.existing.length, by: who(req) });
      if (r.added.length) broadcast({ type: 'data_saved' });
      res.json(r);
    } catch (e) { fail(res, e); }
  });

  // SQLite: the folder scheduled backups go to (backup_dir). It must exist
  // and take a file; the answer says when it is on the database's own drive.
  app.put('/api/setup/backup-dir', requireAuth, csrfCheck, requirePermission('admin.system'), async (req, res) => {
    const db = require('../../../db');
    const dir = String((req.body || {}).dir || '').trim();
    if (!dir || !path.isAbsolute(dir)) return res.status(400).json({ error: 'Give the full path of a folder, such as E:\\OpsPoint backups or /mnt/backup/opspoint.' });
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.opspoint-probe-${process.pid}`);
      fs.writeFileSync(probe, 'x');
      fs.rmSync(probe, { force: true });
    } catch (e) { return res.status(400).json({ error: `OpsPoint can't write to ${dir} (${e.code || e.message}).` }); }
    await db.setSetting('backup_dir', dir);
    await db.save();
    let sameDrive = false;
    try { sameDrive = fs.statSync(dir).dev === fs.statSync(path.dirname(await db.getDbPath())).dev; } catch (e) { /* unknown */ }
    await audit(req, 'setup.backup_dir', 'system', null, 'Backups', { dir, sameDrive, by: who(req) });
    res.json({ ok: true, dir, sameDrive });
  });

  app.put('/api/setup/updates', requireAuth, csrfCheck, requirePermission('admin.system'), async (req, res) => {
    const db = require('../../../db');
    const auto = !!(req.body || {}).auto;
    await db.setSetting('update_auto_check', auto);
    await db.save();
    await audit(req, 'setup.updates', 'system', null, 'Updates', { auto, by: who(req) });
    res.json({ ok: true, auto });
  });

  app.post('/api/setup/finish', requireAuth, csrfCheck, requirePermission('admin.settings'), async (req, res) => {
    try {
      const doctor = doctorOf();
      const r = await service.finish({ compliance: (req.body || {}).compliance, by: who(req), runDoctor: doctor ? () => doctor.run({ fresh: true }) : null });
      await audit(req, 'setup.finish', 'system', null, 'Setup', {
        by: who(req), compliance: (req.body || {}).compliance,
        health: r ? require('../../health').summaryLine(r) : null,
      });
      broadcast({ type: 'settings_updated' });
      res.json({ ok: true, health: r });
    } catch (e) { fail(res, e); }
  });

  app.get('/api/setup/checklist', requireAuth, requirePermission('admin.settings'), async (req, res) => {
    try { const doctor = doctorOf(); res.json(await service.checklist({ latestHealth: doctor ? doctor.latest() : null })); }
    catch (e) { fail(res, e); }
  });

  app.post('/api/setup/checklist/dismiss', requireAuth, csrfCheck, requirePermission('admin.settings'), async (req, res) => {
    try {
      await service.dismissChecklist();
      await audit(req, 'setup.checklist_dismissed', 'system', null, 'Setup', { by: who(req) });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
}

module.exports = { register };
