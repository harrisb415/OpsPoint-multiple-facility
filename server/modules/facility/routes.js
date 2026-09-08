'use strict';
/**
 * Facility routes — HTTP layer only. register(app) attaches facility settings,
 * room management, the auth-protected photo server, and the EHR-config routes.
 * The facility routes share no path prefix with the clients routes, so grouping
 * them here (rather than at their three original inline locations) does not
 * change Express matching.
 */
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { csrfCheck } = require('../../middleware/csrf');
const { audit } = require('../../middleware/audit');
const { broadcast } = require('../../realtime/broadcast');
const service = require('./service');

function register(app) {
  // ── Facility settings ─────────────────────────────────────────────
  app.get('/api/facility/settings', requireAuth, async (req, res) => {
    res.json(await service.getSettings());
  });
  app.put('/api/facility/settings', requireAuth, csrfCheck, requirePermission('admin.settings'), async (req, res) => {
    try {
      const { settings, facilityName } = await service.saveSettings(req.body);
      broadcast({ type: 'settings_updated', settings });
      await audit(req, 'facility.settings', 'settings', null, 'Facility Settings', { facility_name: facilityName });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Facility room management ──────────────────────────────────────
  app.get('/api/facility/rooms', requireAuth, requirePermission('facility.manage'), async (req, res) => {
    res.json(await service.listRooms());
  });
  app.get('/api/facility/rooms/vacant', requireAuth, async (req, res) => {
    res.json(await service.listVacantRooms());
  });
  app.put('/api/facility/rooms/:id', requireAuth, csrfCheck, requirePermission('facility.manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { room } = await service.updateRoom(id, req.body);
      await audit(req, 'facility.room_edit', 'room', id, 'Room ' + room);
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/facility/rooms', requireAuth, csrfCheck, requirePermission('facility.manage'), async (req, res) => {
    try {
      const { client, room, name, is_special } = await service.createRoom(req.body);
      await audit(req, 'facility.room_add', 'room', null, 'Room ' + room, { name, is_special });
      broadcast({ type: 'data_saved', user: req.session.displayName || req.session.username });
      res.json({ ok: true, client });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.delete('/api/facility/rooms/:id', requireAuth, csrfCheck, requirePermission('facility.manage'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { room, name } = await service.deleteRoom(id);
      await audit(req, 'facility.room_delete', 'room', id, 'Room ' + room, { name });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/facility/reorder', requireAuth, csrfCheck, requirePermission('facility.manage'), async (req, res) => {
    try {
      const { count } = await service.reorder(req.body.order);
      await audit(req, 'facility.reorder', 'room', null, 'Room reorder', { count });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.post('/api/facility/reset', requireAuth, csrfCheck, requirePermission('facility.manage'), async (req, res) => {
    try {
      const { count } = await service.reset(req.body.rooms);
      await audit(req, 'facility.reset', 'room', null, 'Roster reset', { count });
      broadcast({ type: 'data_saved', user: req.session.displayName });
      res.json({ ok: true, count });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Serve data photos (auth-protected) ───────────────────────────
  app.get('/photos/:filename', requireAuth, (req, res) => {
    const fname = path.basename(req.params.filename); // prevent traversal
    const full = path.join(config.DATA_DIR, 'photos', fname);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
    res.sendFile(full);
  });

  // ── Facility settings extension — program tracks / phases / etc. ──
  app.get('/api/facility/ehr-config', requireAuth, async (req, res) => {
    res.json(await service.getEhrConfig());
  });
  app.put('/api/facility/ehr-config', requireAuth, csrfCheck, requirePermission('admin.settings'), async (req, res) => {
    try {
      const { fields } = await service.saveEhrConfig(req.body || {});
      await audit(req, 'facility.ehr_config', 'settings', null, 'EHR configuration', { fields });
      broadcast({ type: 'settings_updated' });
      res.json({ ok: true });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}

module.exports = { register };
