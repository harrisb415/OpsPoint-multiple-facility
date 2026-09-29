'use strict';
/**
 * Every action a screen offers: when the UI shows it (`show`: any of these
 * permission sets, each needing all of its permissions) and the requests it
 * sends, copied from the client code named in `where`. [[]] = shown to
 * everyone signed in.
 *
 * When you add or change a button, update its entry here — the audit can only
 * check what it knows the UI does. Routes with a permission guard that no entry
 * touches are listed at the end of every run.
 *
 * Options: setup(h) makes fixtures (as an all-permission admin) and returns
 * them to run(a, fx, h); `reverse: false` skips the "is it enforced?" run
 * (for actions the server deliberately allows to everyone); `probeOnly` runs
 * only that reverse check; `staticRoute` compares gates without running (for
 * restart / reset / update); `freshUser` gives the run its own account.
 */
const { EVERYONE } = require('./engine.cjs');

// A 1×1 PNG: the smallest photo the log-photo route accepts.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const hoursFromNow = (h) => new Date(Date.now() + h * 3600000).toISOString();
const reportOf = async (a) => {
  const d = (await a.get('/api/data')).body;
  return (d.reports || []).find(r => r.id === d.active_report_id);
};
const MOBILE = 'mobile.access';
let added = 0;   // rooms for "Add a resident", clear of the fixtures' range
const withMobile = (sets) => sets.map(s => [MOBILE, ...s]);

module.exports = [
  // ── Report tab (client/src/pages/ReportTab.jsx) — visible to everyone ──
  {
    id: 'report.new', area: 'Report tab', label: 'Start a new shift report',
    where: 'ReportTab.jsx — "New Report" (canCreate)', show: [['reports.create']],
    run: async (a) => {
      const d = (await a.get('/api/data')).body;
      const nid = Math.max(0, ...(d.reports || []).map(r => r.id)) + 1;
      await a.post('/api/data', { reports: [{ id: nid, report_date: new Date().toLocaleDateString('en-CA'), shift: 'Day Shift', mod_name: '', is_closed: false,
        statuses: {}, comments: {}, last_ua: {}, last_room_search: {}, issues: [], med_notes: [], log_entries: [] }], active_report_id: nid });
    },
  },
  {
    id: 'report.close', area: 'Report tab', label: 'Close the shift',
    where: 'ReportTab.jsx — "Close Shift" (canClose = reports.close && reports.create)', show: [['reports.close', 'reports.create']],
    setup: async (h) => ({ id: await h.report() }),
    run: async (a) => {
      const r = await reportOf(a);
      await a.post('/api/data', { reports: [{ ...r, is_closed: true, roster_snapshot: [] }], active_report_id: null });
    },
  },
  {
    id: 'report.details', area: 'Report tab', label: 'Edit Shift Details (date, shift, PA on duty)',
    where: 'ReportTab.jsx — Shift Details fields (canCreate)', show: [['reports.create']],
    setup: async (h) => ({ id: await h.report() }),
    run: async (a, fx) => { await a.patch('/api/data', { reportId: fx.id, shiftData: { report_date: new Date().toLocaleDateString('en-CA'), shift: 'Swing Shift', mod_name: 'Audit' } }); },
  },
  {
    id: 'report.comment', area: 'Report tab', label: 'Type a roster comment',
    where: 'ReportTab.jsx — roster comment box (canStatus), saved per resident', show: [['status.edit']],
    setup: async (h) => ({ id: await h.report(), resident: await h.resident() }),
    run: async (a, fx) => { await a.patch('/api/data', { reportId: fx.id, comments: { [fx.resident.id]: 'Audit comment' } }); },
  },
  {
    id: 'report.status', area: 'Report tab', label: 'Change a resident\'s status',
    where: 'ReportTab.jsx — roster status select (canStatus)', show: [['status.edit']],
    setup: async (h) => ({ id: await h.report(), resident: await h.resident() }),
    run: async (a, fx) => { await a.patch('/api/data', { reportId: fx.id, statuses: { [fx.resident.id]: 'hospital' } }); },
  },
  {
    id: 'report.log', area: 'Report tab', label: 'Add a log entry (form or Wellness / Walkthrough / Lunch buttons)',
    where: 'ReportTab.jsx — log form and quick buttons (canLog)', show: [['log.add']],
    setup: async (h) => ({ id: await h.report() }),
    run: async (a, fx) => { await a.patch('/api/data', { reportId: fx.id, log_entry: { time: '10:00 AM', text: 'Audit entry' } }); },
  },
  {
    id: 'report.log.delete', area: 'Report tab', label: 'Delete a log entry',
    where: 'ReportTab.jsx — log entry delete (canDelLog), with a reason', show: [['log.delete']],
    setup: async (h) => ({ entry: await h.logEntry() }),
    run: async (a, fx) => { await a.del(`/api/log/${fx.entry}`, { reason: 'Audit: wrong report' }); },
  },
  {
    id: 'report.issues', area: 'Report tab', label: 'Add or remove an issue / medical note',
    where: 'ReportTab.jsx — Issues and Medical Notes panels (canIssues)', show: [['issues.edit']],
    setup: async (h) => ({ id: await h.report() }),
    run: async (a, fx) => {
      await a.patch('/api/data', { reportId: fx.id, issues: ['Audit issue'] });
      await a.patch('/api/data', { reportId: fx.id, med_notes: ['Audit med note'] });
    },
  },
  {
    id: 'report.roomsearch', area: 'Report tab', label: 'Room Search button',
    where: 'ReportTab.jsx — quick button inside the canLog block', show: [['log.add']],
    setup: async (h) => ({ id: await h.report(), resident: await h.resident() }),
    run: async (a, fx) => {
      await a.patch('/api/data', { reportId: fx.id, log_entry: { time: '10:05 AM', text: 'Room search' } });
      await a.patch('/api/data', { reportId: fx.id, last_room_search: { [fx.resident.id]: 'Sep 28, 2026' } });
    },
  },
  {
    id: 'report.ua', area: 'Report tab', label: '🧪 UA button (record a UA)',
    where: 'ReportTab.jsx — quick button (canLog && ua.record) → ConductUAModal', show: [['log.add', 'ua.record']],
    setup: async (h) => { await h.report(); return { resident: await h.resident() }; },
    run: async (a, fx, h) => { await a.post('/api/ua-records', h.uaBody(fx.resident)); },
  },
  {
    id: 'report.mail', area: 'Report tab', label: '✉ Mail button',
    where: 'ReportTab.jsx — quick button (canLog && mail.log)', show: [['log.add', 'mail.log']],
    setup: async (h) => { await h.report(); return { resident: await h.resident() }; },
    run: async (a, fx) => { await a.post('/api/mail', { clients: [{ client_id: fx.resident.id, client_name: fx.resident.name, room: fx.resident.room, notes: '', mail_type: 'letter' }], log_time: '10:10 AM' }); },
  },
  {
    id: 'report.infraction', area: 'Report tab', label: '⚠ Infraction button',
    where: 'ReportTab.jsx — quick button (canLog && violations.log): files it, then logs a line', show: [['log.add', 'violations.log']],
    setup: async (h) => ({ id: await h.report(), resident: await h.resident() }),
    run: async (a, fx) => {
      await a.post('/api/violations', { client_id: fx.resident.id, client_name: fx.resident.name, room: fx.resident.room, violation_date: new Date().toLocaleDateString('en-CA'), description: 'Audit', staff_name: 'Sam Staff', notes: '' });
      await a.patch('/api/data', { reportId: fx.id, log_entry: { time: '10:15 AM', text: `Infraction filed — ${fx.resident.name}` } });
    },
  },
  {
    id: 'report.ua.request', area: 'Report tab', label: 'Request a UA from the roster',
    where: 'ReportTab.jsx — roster action (canUA)', show: [['ua.request']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.post('/api/ua-requests', { client_id: fx.resident.id, client_name: fx.resident.name, room: fx.resident.room }); },
  },
  {
    id: 'report.ua.photo', area: 'Report tab', label: 'Attach the cup photo to a UA line (once)',
    where: 'ReportTab.jsx — "📷 Photo" on UA lines (canPhoto = ua.record, report open)', show: [['ua.record']],
    setup: async (h) => ({ rec: await h.uaRecord() }),
    run: async (a, fx) => { await a.post(`/api/log/${fx.rec.logEntryId}/photo`, { photo: PNG }); },
  },
  {
    id: 'report.ua.void', area: 'Report tab', label: 'Void a UA line', where: 'ReportTab.jsx LogEntry — "Void" on UA lines (ua.void)', show: [['ua.void']],
    setup: async (h) => ({ rec: await h.uaRecord() }),
    run: async (a, fx) => { await a.post(`/api/log/${fx.rec.logEntryId}/void`, { reason: 'Audit: duplicate entry' }); },
  },
  {
    id: 'report.bulksave.bypass', area: 'Report tab', label: 'The bulk report save cannot delete log entries or change statuses without log.delete / status.edit',
    where: 'POST /api/data (what New Report and Close Shift send)', show: [['log.delete', 'status.edit']], probeOnly: true,
    setup: async (h) => ({ id: await h.report(), entry: await h.logEntry(), resident: await h.resident() }),
    run: async (a, fx, h) => {
      const r = await reportOf(a);
      await a.post('/api/data', { reports: [{ ...r, log_entries: [], statuses: { ...(r.statuses || {}), [fx.resident.id]: 'hospital' } }] });
      const after = (await h.admin.get('/api/data')).body.reports.find(x => x.id === fx.id);
      const gone = !(after.log_entries || []).some(e => e.id === fx.entry);
      const changed = (after.statuses || {})[fx.resident.id] === 'hospital';
      return gone || changed;   // false = the server held both
    },
  },

  // ── Archive (ArchiveTab.jsx) ──
  {
    id: 'archive.delete', area: 'Archive', label: 'Delete a closed report (first 24 hours, with a reason)',
    where: 'ArchiveTab.jsx (canDelete = reports.delete)', show: [['reports.delete']],
    setup: async (h) => ({ id: await h.closedReport() }),
    run: async (a, fx) => { await a.del(`/api/reports/${fx.id}`, { reason: 'Audit: duplicate report' }); },
  },

  // ── Residents (ClientsTab.jsx) ──
  {
    id: 'residents.add', area: 'Residents', label: 'Add a resident', where: 'ClientsTab.jsx (canEdit = residents.edit)', show: [['residents.edit']],
    run: async (a) => { await a.post('/api/clients', { name: 'Audit Added', room: String(20000 + (++added)) }); },
  },
  {
    id: 'residents.edit', area: 'Residents', label: 'Edit a resident', where: 'ClientsTab.jsx (canEdit)', show: [['residents.edit']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.put(`/api/clients/${fx.resident.id}`, { name: `${fx.resident.name} Edited`, room: fx.resident.room }); },
  },
  {
    id: 'residents.discharge', area: 'Residents', label: 'Discharge a resident', where: 'ClientsTab.jsx (canEdit)', show: [['residents.edit']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.post('/api/discharge-records', { client_id: fx.resident.id, discharge_date: new Date().toLocaleDateString('en-CA'), reason: 'graduate', narrative: '', aftercare_plan: '', referrals_made: [] }); },
  },
  {
    id: 'residents.reactivate', area: 'Residents', label: 'Reactivate a discharged resident', where: 'ClientsTab.jsx (canEdit)', show: [['residents.edit']],
    setup: async (h) => {
      const c = await h.resident();
      await h.admin.post('/api/discharge-records').send({ client_id: c.id, discharge_date: h.today(), reason: 'graduate', narrative: '', aftercare_plan: '', referrals_made: [] });
      return { resident: c };
    },
    run: async (a, fx) => { await a.put(`/api/clients/${fx.resident.id}`, { room: String(30000 + fx.resident.id), is_active: true, discharge_date: null }); },
  },

  // ── Resident profile drawer (components/ClientProfile.jsx) ──
  {
    id: 'profile.ua.request', area: 'Resident profile', label: 'Request a UA (profile UA tab)',
    where: 'ClientProfile.jsx — UA tab shows with ua.acknowledge or ua.record; button needs ua.request',
    show: [['ua.acknowledge', 'ua.request'], ['ua.record', 'ua.request']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.post('/api/ua-requests', { client_id: fx.resident.id, client_name: fx.resident.name, room: fx.resident.room }); },
  },
  {
    id: 'profile.consents', area: 'Resident profile', label: 'Open the Consents tab',
    where: 'ClientProfile.jsx — tab shows with consent.manage; loads the consent list',
    show: [['consent.manage']],
    setup: async (h) => ({ c: await h.consent() }),
    run: async (a, fx) => { await a.get(`/api/consent-records/${fx.c.clientId}`); },
  },
  {
    id: 'profile.groups', area: 'Resident profile', label: 'Open the Groups tab', where: 'ClientProfile.jsx — tab shows with groups.view', show: [['groups.view']],
    run: async (a) => { await a.get('/api/group-sessions?from=2000-01-01&to=2099-12-31'); },
  },

  // ── Passes (PassesTab.jsx) ──
  {
    id: 'passes.new', area: 'Passes', label: 'New pass', where: 'PassesTab.jsx (canEdit = passes.edit)', show: [['passes.edit']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.post('/api/passes', { client_id: fx.resident.id, room: fx.resident.room, name: fx.resident.name, departure: hoursFromNow(1), return_date: hoursFromNow(30), ua_notes: '', notes: '', status: 'Approved' }); },
  },
  {
    id: 'passes.edit', area: 'Passes', label: 'Edit a pass', where: 'PassesTab.jsx (canEdit)', show: [['passes.edit']],
    setup: async (h) => ({ p: await h.pass('Approved') }),
    run: async (a, fx) => { await a.put(`/api/passes/${fx.p.id}`, { client_id: fx.p.client_id, room: fx.p.room, name: fx.p.name, departure: hoursFromNow(2), return_date: hoursFromNow(40), ua_notes: '', notes: 'edited', status: 'Approved' }); },
  },
  {
    id: 'passes.depart', area: 'Passes', label: 'Mark departed', where: 'PassesTab.jsx (canStatus = passes.status or passes.edit)', show: [['passes.status'], ['passes.edit']],
    setup: async (h) => ({ p: await h.pass('Approved') }),
    run: async (a, fx) => { await a.put(`/api/passes/${fx.p.id}`, { status: 'Out' }); },
  },
  {
    id: 'passes.return', area: 'Passes', label: 'Mark returned', where: 'PassesTab.jsx (canStatus)', show: [['passes.status'], ['passes.edit']],
    setup: async (h) => ({ p: await h.pass('Out') }),
    run: async (a, fx) => { await a.put(`/api/passes/${fx.p.id}`, { status: 'Returned' }); },
  },
  {
    id: 'passes.extend', area: 'Passes', label: 'Extend a pass', where: 'PassesTab.jsx (canStatus) — status + new return date', show: [['passes.status'], ['passes.edit']],
    setup: async (h) => ({ p: await h.pass('Out') }),
    run: async (a, fx) => { await a.put(`/api/passes/${fx.p.id}`, { status: 'Extended', return_date: hoursFromNow(6), tz: 'America/Los_Angeles' }); },
  },
  {
    id: 'passes.reopen', area: 'Passes', label: 'Reopen a returned pass as departed', where: 'PassesTab.jsx (canStatus)', show: [['passes.status'], ['passes.edit']],
    setup: async (h) => ({ p: await h.pass('Returned') }),
    run: async (a, fx) => { await a.put(`/api/passes/${fx.p.id}`, { status: 'Out' }); },
  },
  {
    id: 'passes.delete', area: 'Passes', label: 'Delete a pass', where: 'PassesTab.jsx (canEdit)', show: [['passes.edit']],
    setup: async (h) => ({ p: await h.pass('Approved') }),
    run: async (a, fx) => { await a.del(`/api/passes/${fx.p.id}`); },
  },
  {
    id: 'passes.notice', area: 'Passes', label: 'Save the pass notice', where: 'PassesTab.jsx (canEdit)', show: [['passes.edit']],
    run: async (a) => { await a.put('/api/pass-notice', { notice: 'Audit notice' }); },
  },

  // ── Mail (MailTab.jsx) ──
  {
    id: 'mail.log', area: 'Mail', label: 'Log mail', where: 'MailTab.jsx (canLog = mail.log)', show: [['mail.log']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.post('/api/mail', { clients: [{ client_id: fx.resident.id, client_name: fx.resident.name, room: fx.resident.room, notes: '', mail_type: 'letter' }] }); },
  },
  {
    id: 'mail.approve', area: 'Mail', label: 'Approve mail', where: 'MailTab.jsx (canApprove = mail.approve)', show: [['mail.approve']],
    setup: async (h) => ({ m: await h.mail('pending') }),
    run: async (a, fx) => { await a.put(`/api/mail/${fx.m.id}/approve`, {}); },
  },
  {
    id: 'mail.deliver', area: 'Mail', label: 'Deliver mail', where: 'MailTab.jsx (canDeliver = mail.deliver)', show: [['mail.deliver']],
    setup: async (h) => ({ m: await h.mail('approved') }),
    run: async (a, fx) => { await a.put(`/api/mail/${fx.m.id}/deliver`, {}); },
  },
  {
    id: 'mail.delete', area: 'Mail', label: 'Delete a mail record (with a reason)', where: 'MailTab.jsx (canDelete = mail.delete)', show: [['mail.delete']],
    setup: async (h) => ({ m: await h.mail('pending') }),
    run: async (a, fx) => { await a.del(`/api/mail/${fx.m.id}`, { reason: 'Audit: logged twice' }); },
  },

  // ── UA (UARequestsTab.jsx) and the sidebar UA draw (AppShell.jsx) ──
  {
    id: 'ua.request', area: 'UA', label: 'Request a UA', where: 'UARequestsTab.jsx (canRequest = ua.request)', show: [['ua.request']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.post('/api/ua-requests', { client_id: fx.resident.id, client_name: fx.resident.name, room: fx.resident.room }); },
  },
  {
    // reverse: false — the server also lets ua.record acknowledge, on purpose:
    // recording a UA acknowledges its request.
    id: 'ua.ack', area: 'UA', label: 'Acknowledge a UA request', where: 'UARequestsTab.jsx (canAck = ua.acknowledge)', show: [['ua.acknowledge']], reverse: false,
    setup: async (h) => ({ req: await h.uaRequest() }),
    run: async (a, fx) => { await a.post(`/api/ua-requests/${fx.req.id}/acknowledge`, {}); },
  },
  {
    id: 'ua.cancel', area: 'UA', label: 'Cancel a pending UA request', where: 'UARequestsTab.jsx (canAck || canRecord)', show: [['ua.acknowledge'], ['ua.record']],
    setup: async (h) => ({ req: await h.uaRequest() }),
    run: async (a, fx) => { await a.del(`/api/ua-requests/${fx.req.id}`); },
  },
  {
    id: 'ua.conduct', area: 'UA', label: 'Conduct a UA from a request', where: 'UARequestsTab.jsx (canRecord) → ConductUAModal', show: [['ua.record']],
    setup: async (h) => { await h.report(); const req = await h.uaRequest(); return { req }; },
    run: async (a, fx, h) => {
      await a.post('/api/ua-records', h.uaBody({ id: fx.req.client_id, name: fx.req.client_name, room: fx.req.room }));
      await a.post(`/api/ua-requests/${fx.req.id}/acknowledge`, {});
    },
  },
  {
    id: 'ua.new', area: 'UA', label: 'New UA (no request)', where: 'UARequestsTab.jsx (canRecord)', show: [['ua.record']],
    setup: async (h) => { await h.report(); return { resident: await h.resident() }; },
    run: async (a, fx, h) => { await a.post('/api/ua-records', h.uaBody(fx.resident)); },
  },
  {
    id: 'ua.photo', area: 'UA', label: 'Chain-of-custody photo on a UA record', where: 'UARequestsTab.jsx (canRecord)', show: [['ua.record']],
    setup: async (h) => ({ rec: await h.uaRecord() }),
    run: async (a, fx) => { await a.post(`/api/log/${fx.rec.logEntryId}/photo`, { photo: PNG }); },
  },
  {
    id: 'ua.void', area: 'UA', label: 'Void a UA record (they are never deleted)', where: 'UARequestsTab.jsx (canVoid = ua.void) → VoidModal', show: [['ua.void']],
    setup: async (h) => ({ rec: await h.uaRecord() }),
    run: async (a, fx) => { await a.post(`/api/ua-records/${fx.rec.id}/void`, { reason: 'Audit: entered for the wrong resident' }); },
  },
  {
    id: 'ua.draw', area: 'UA', label: 'Run a random UA draw', where: 'AppShell.jsx sidebar "UA Draw" (ua.draw)', show: [['ua.draw']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => {
      await a.get('/api/ua-draws/recent-clients?days=30');
      await a.post('/api/ua-draws', { residents: [{ id: fx.resident.id, name: fx.resident.name, room: fx.resident.room }], method: 'random' });
    },
  },

  // ── Notification bell (AppShell.jsx) ──
  {
    id: 'bell.ack', area: 'Notification bell', label: 'Ack a UA request', where: 'AppShell.jsx NotifPanel — UA section (ua.acknowledge)', show: [['ua.acknowledge']], reverse: false,
    setup: async (h) => ({ req: await h.uaRequest() }),
    run: async (a, fx) => { await a.post(`/api/ua-requests/${fx.req.id}/acknowledge`, {}); },
  },
  {
    id: 'bell.conduct', area: 'Notification bell', label: 'Conduct UA from the bell', where: 'AppShell.jsx NotifPanel — UA section (ua.acknowledge) + button (ua.record)', show: [['ua.acknowledge', 'ua.record']],
    setup: async (h) => { await h.report(); return { req: await h.uaRequest() }; },
    run: async (a, fx, h) => {
      await a.post(`/api/ua-requests/${fx.req.id}/acknowledge`, {});
      await a.post('/api/ua-records', h.uaBody({ id: fx.req.client_id, name: fx.req.client_name, room: fx.req.room }));
    },
  },
  {
    id: 'bell.past', area: 'Notification bell', label: 'Past 24 hours list', where: 'DataContext.jsx — loaded for everyone', show: EVERYONE, reverse: false,
    run: async (a) => { await a.get('/api/ua-requests/recent'); },
  },
  {
    id: 'announce.send', area: 'Header', label: 'Send an announcement', where: 'AppShell.jsx — "Announce" in the shift-actions menu (broadcast.send)', show: [['broadcast.send']],
    run: async (a) => { await a.post('/api/broadcasts', { message: 'Audit announcement' }); },
  },

  // ── Infractions (ViolationsTab.jsx) ──
  {
    id: 'violations.log', area: 'Infractions', label: 'Log an infraction', where: 'ViolationsTab.jsx (canLog = violations.log)', show: [['violations.log']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.post('/api/violations', { client_id: fx.resident.id, client_name: fx.resident.name, room: fx.resident.room, violation_date: new Date().toLocaleDateString('en-CA'), description: 'Audit', staff_name: 'Sam Staff', notes: '' }); },
  },
  {
    id: 'violations.review', area: 'Infractions', label: 'Review an infraction (assign or waive)', where: 'ViolationsTab.jsx (canReview = violations.review)', show: [['violations.review']],
    setup: async (h) => ({ v: await h.violation('pending'), w: await h.violation('pending') }),
    run: async (a, fx) => {
      await a.put(`/api/violations/${fx.v.id}/review`, { action: 'assign', consequence: 'Audit consequence' });
      await a.put(`/api/violations/${fx.w.id}/review`, { action: 'waive' });
    },
  },
  {
    id: 'violations.complete', area: 'Infractions', label: 'Mark a consequence complete', where: 'ViolationsTab.jsx (canComplete = violations.complete)', show: [['violations.complete']],
    setup: async (h) => ({ v: await h.violation('assigned') }),
    run: async (a, fx) => { await a.put(`/api/violations/${fx.v.id}/complete`, {}); },
  },
  {
    id: 'violations.void', area: 'Infractions', label: 'Void an infraction (with a reason)', where: 'ViolationsTab.jsx (canVoid = violations.void)', show: [['violations.void']],
    setup: async (h) => ({ v: await h.violation('pending') }),
    run: async (a, fx) => { await a.post(`/api/violations/${fx.v.id}/void`, { reason: 'Audit: wrong resident' }); },
  },

  // ── Chores (ChoresTab.jsx) ──
  {
    id: 'chores.master', area: 'Chores', label: 'Edit the master chore list', where: 'ChoresTab.jsx (canAssign = chores.assign)', show: [['chores.assign']],
    run: async (a) => { await a.put('/api/master-chores', { chores: ['Dishes', 'Trash', 'Audit'] }); },
  },
  {
    id: 'chores.assign', area: 'Chores', label: 'Assign a chore to a resident', where: 'ChoresTab.jsx (canAssign)', show: [['chores.assign']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.patch(`/api/clients/${fx.resident.id}/chore`, { chore: 'Dishes', chore_time: 'PM' }); },
  },
  {
    id: 'chores.log', area: 'Chores', label: 'Sign off a chore', where: 'ChoresTab.jsx (canLog = chores.log)', show: [['chores.log']],
    setup: async (h) => {
      const c = await h.resident();
      await h.admin.patch(`/api/clients/${c.id}/chore`).send({ chore: 'Dishes', chore_time: 'PM' });
      return { resident: c };
    },
    run: async (a, fx) => { await a.put('/api/chore-log', { client_id: fx.resident.id, log_date: new Date().toLocaleDateString('en-CA'), initials: 'AU' }); },
  },

  // ── Staff directory (StaffTab.jsx) ──
  {
    id: 'staff.add', area: 'Staff', label: 'Add, edit or remove a staff member', where: 'StaffTab.jsx (canEdit = staff.edit)', show: [['staff.edit']],
    setup: async (h) => ({ id: await h.staff() }),
    run: async (a, fx) => {
      await a.post('/api/staff', { name: 'Audit New', category: 'Other', phone: '', phone2: '', notes: '' });
      await a.put(`/api/staff/${fx.id}`, { name: 'Audit Renamed', category: 'Other', phone: '', phone2: '', notes: '' });
      await a.del(`/api/staff/${fx.id}`);
    },
  },

  // ── Groups tab (GroupsTab.jsx) — the tab itself needs groups.view ──
  {
    id: 'groups.attendance', area: 'Groups', label: 'Log group attendance',
    where: 'GroupsTab.jsx — tab needs groups.view; canLog = groups.log || clinical.groups',
    show: [['groups.view', 'groups.log'], ['groups.view', 'clinical.groups']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx, h) => { await a.post('/api/clinical/group-notes', h.clinicalBody('group-notes', fx.resident.id)); },
  },
  {
    id: 'groups.master', area: 'Groups', label: 'Add or remove a group name (master list)',
    where: 'GroupsTab.jsx — same canLog as attendance', show: [['groups.view', 'groups.log'], ['groups.view', 'clinical.groups']],
    run: async (a) => { await a.put('/api/master-groups', { groups: ['Morning Group', 'Audit Group'] }); },
  },
  {
    id: 'groups.edit', area: 'Groups', label: 'Edit or delete a group record',
    where: 'GroupsTab.jsx — SessionCard Edit / Delete (canLog)', show: [['groups.view', 'groups.log'], ['groups.view', 'clinical.groups']],
    setup: async (h) => ({ g: await h.clinical('group-notes'), d: await h.clinical('group-notes') }),
    run: async (a, fx) => {
      await a.put(`/api/clinical/group-notes/${fx.g.id}`, { topic: 'Edited', attendees: [{ client_id: fx.g.clientId, participation: 'excused' }] });
      await a.del(`/api/clinical/group-notes/${fx.d.id}`);
    },
  },

  // ── Clinical section (pages/clinical/*) — each page needs its permission ──
  ...[['notes', 'clinical.notes', 'Clinical notes'], ['treatment-plans', 'clinical.treatment', 'Treatment plans'],
    ['assessments', 'clinical.assessments', 'Assessments'], ['group-notes', 'clinical.groups', 'Group notes (clinical)'],
    ['discharge-summaries', 'clinical.discharge', 'Discharge summaries']].map(([seg, perm, name]) => ({
    id: `clinical.${seg}`, area: 'Clinical', label: `${name}: create, edit, sign, delete`,
    where: `pages/clinical — page shows with ${perm}; all four buttons use clinicalApi('${seg}')`, show: [[perm]],
    setup: async (h) => ({ resident: await h.resident(), del: await h.clinical(seg) }),
    run: async (a, fx, h) => {
      const r = await a.post(`/api/clinical/${seg}`, h.clinicalBody(seg, fx.resident.id));
      const id = r.body && r.body.record && r.body.record.id;
      if (id) {
        await a.put(`/api/clinical/${seg}/${id}`, seg === 'group-notes' ? { topic: 'Edited', attendees: [{ client_id: fx.resident.id, participation: 'present' }] } : { status: 'active' });
        await a.patch(`/api/clinical/${seg}/${id}/sign`, {});
      }
      await a.del(`/api/clinical/${seg}/${fx.del.id}`);
    },
  })),
  {
    id: 'incidents.file', area: 'Clinical', label: 'File or edit an incident report', where: 'IncidentsTab.jsx (canLog = incidents.log)', show: [['incidents.log']],
    setup: async (h) => ({ resident: await h.resident(), id: await h.incident() }),
    run: async (a, fx) => {
      await a.post('/api/incidents', { client_id: fx.resident.id, incident_date: new Date().toLocaleDateString('en-CA'), incident_time: '', narrative: 'Audit', severity: 'low', incident_type: 'Behavior', corrective_action: '', notifications_required: [] });
      await a.put(`/api/incidents/${fx.id}`, { narrative: 'edited', incident_time: '10:00', corrective_action: '' });
    },
  },
  {
    id: 'incidents.review', area: 'Clinical', label: 'Review an incident', where: 'IncidentsTab.jsx (canReview = incidents.review)', show: [['incidents.review']],
    setup: async (h) => ({ id: await h.incident() }),
    run: async (a, fx) => { await a.put(`/api/incidents/${fx.id}/review`, { status: 'reviewed', review_notes: 'ok' }); },
  },
  {
    id: 'incidents.void', area: 'Clinical', label: 'Void an incident report (with a reason)', where: 'IncidentsTab.jsx (canVoid = incidents.void)', show: [['incidents.void']],
    setup: async (h) => ({ id: await h.incident() }),
    run: async (a, fx) => { await a.post(`/api/incidents/${fx.id}/void`, { reason: 'Audit: wrong resident' }); },
  },
  {
    id: 'incidents.unlock', area: 'Clinical', label: 'Unlock a sealed incident',
    where: 'IncidentsTab.jsx — page needs an incidents permission; button needs records.unlock',
    show: [['incidents.log', 'records.unlock'], ['incidents.review', 'records.unlock'], ['incidents.void', 'records.unlock']],
    setup: async (h) => ({ id: await h.incident({ locked: true }) }),
    run: async (a, fx) => { await a.post(`/api/incidents/${fx.id}/unlock`, { reason: 'Audit correction' }); },
  },
  {
    id: 'milestones.edit', area: 'Clinical', label: 'Add, edit, waive or delete a milestone', where: 'MilestonesTab.jsx (canEdit = milestones.edit)', show: [['milestones.edit']],
    setup: async (h) => ({ resident: await h.resident(), id: await h.milestone(), w: await h.milestone(), d: await h.milestone() }),
    run: async (a, fx) => {
      await a.post('/api/milestones', { client_id: fx.resident.id, phase: 'phase1', objective: 'Audit', target_date: '', notes: '' });
      await a.put(`/api/milestones/${fx.id}`, { objective: 'Audit edited' });
      await a.put(`/api/milestones/${fx.w}`, { status: 'waived', completion_date: null });
      await a.del(`/api/milestones/${fx.d}`);
    },
  },
  {
    id: 'milestones.signoff', area: 'Clinical', label: 'Sign off a milestone', where: 'MilestonesTab.jsx (canSignoff = milestones.signoff)', show: [['milestones.signoff']],
    setup: async (h) => ({ id: await h.milestone() }),
    run: async (a, fx) => { await a.put(`/api/milestones/${fx.id}/signoff`, {}); },
  },
  {
    id: 'milestones.unlock', area: 'Clinical', label: 'Unlock a sealed milestone',
    where: 'MilestonesTab.jsx — page needs a milestones permission; button needs records.unlock',
    show: [['milestones.edit', 'records.unlock'], ['milestones.signoff', 'records.unlock']],
    setup: async (h) => ({ id: await h.milestone({ locked: true }) }),
    run: async (a, fx) => { await a.post(`/api/milestones/${fx.id}/unlock`, { reason: 'Audit correction' }); },
  },

  // ── Consents (ConsentTab.jsx) — the tab needs consent.manage ──
  {
    id: 'consents.manage', area: 'Consents', label: 'View, record and revoke consents', where: 'ConsentTab.jsx (canManage = consent.manage)', show: [['consent.manage']],
    setup: async (h) => ({ c: await h.consent(), resident: await h.resident() }),
    run: async (a, fx) => {
      await a.get(`/api/consent-records/${fx.c.clientId}`);
      await a.post('/api/consent-records', { client_id: fx.resident.id, recipient_name: 'Audit Agency', recipient_org: '', purpose: 'Audit', information_type: 'all', effective_date: new Date().toLocaleDateString('en-CA'), expiration_date: '', signature_on_file: true });
      await a.put(`/api/consent-records/${fx.c.id}/revoke`, {});
    },
  },
  {
    id: 'consents.disclosures', area: 'Consents', label: 'View the disclosure log', where: 'ConsentTab.jsx — tab (consent.manage) + panel (disclosures.view)', show: [['consent.manage', 'disclosures.view']],
    setup: async (h) => ({ c: await h.consent() }),
    run: async (a, fx) => { await a.get(`/api/disclosures/${fx.c.clientId}`); },
  },

  // ── Mobile app (client/src/mobile) — every screen needs mobile.access ──
  {
    id: 'm.open', area: 'Mobile app', label: 'Open the app (snapshot, resident card, staff directory)', where: 'mobile/useSnapshot.js, Resident.jsx', show: [[MOBILE]],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => {
      await a.get('/api/m/snapshot');
      await a.get(`/api/m/residents/${fx.resident.id}`);
      await a.get('/api/staff');
    },
  },
  {
    id: 'm.round', area: 'Mobile app', label: 'Start, mark and finish a wellness round', where: 'mobile/Rounds.jsx (canLog = log.add)', show: [[MOBILE, 'log.add']],
    setup: async (h) => {
      await h.report();
      const cur = await h.admin.get('/api/rounds/current');
      const open = cur.body && (cur.body.round || cur.body.current);
      if (open && open.id) await h.admin.post(`/api/rounds/${open.id}/finish`).send({});
      return { resident: await h.resident() };
    },
    run: async (a, fx) => {
      const r = await a.post('/api/rounds', {});
      const id = r.body && r.body.round && r.body.round.id;
      if (!id) return;
      await a.put(`/api/rounds/${id}/marks/${fx.resident.id}`, { mark: 'ok' });
      await a.post(`/api/rounds/${id}/finish`, {});
    },
  },
  {
    id: 'm.found', area: 'Mobile app', label: 'Record a not-located resident as found', where: 'mobile/Rounds.jsx (canLog && reportOpen)', show: [[MOBILE, 'log.add']],
    setup: async (h) => h.missingFromFinishedRound(),
    run: async (a, fx) => { await a.post(`/api/rounds/${fx.roundId}/marks/${fx.clientId}/found`, { note: '' }); },
  },
  {
    id: 'm.log', area: 'Mobile app', label: 'Add a log entry or walkthrough', where: 'mobile/Log.jsx, Rounds.jsx walkthrough (canLog)', show: [[MOBILE, 'log.add']],
    setup: async (h) => ({ id: await h.report() }),
    run: async (a, fx) => { await a.patch('/api/data', { reportId: fx.id, log_entry: { time: '11:00 AM', text: 'Audit mobile entry' } }); },
  },
  {
    id: 'm.foryou.ua', area: 'Mobile app', label: 'For you: acknowledge a UA request', where: 'mobile/ForYou.jsx — group "ua" (ua.acknowledge or ua.record)', show: withMobile([['ua.acknowledge'], ['ua.record']]),
    setup: async (h) => ({ req: await h.uaRequest() }),
    run: async (a, fx) => { await a.post(`/api/ua-requests/${fx.req.id}/acknowledge`, {}); },
  },
  {
    id: 'm.foryou.passes', area: 'Mobile app', label: 'For you / resident card: pass Returned, Checked out, Extend',
    where: 'mobile/ForYou.jsx, Resident.jsx, sheets.jsx (passes.status or passes.edit)', show: withMobile([['passes.status'], ['passes.edit']]),
    setup: async (h) => ({ out: await h.pass('Out'), approved: await h.pass('Approved'), ext: await h.pass('Out') }),
    run: async (a, fx) => {
      await a.put(`/api/passes/${fx.out.id}`, { status: 'Returned' });
      await a.put(`/api/passes/${fx.approved.id}`, { status: 'Out' });
      await a.put(`/api/passes/${fx.ext.id}`, { status: 'Extended', return_date: hoursFromNow(8), tz: 'America/Los_Angeles' });
    },
  },
  {
    id: 'm.foryou.mail.approve', area: 'Mobile app', label: 'For you: approve mail', where: 'mobile/ForYou.jsx (mail.approve)', show: withMobile([['mail.approve']]),
    setup: async (h) => ({ m: await h.mail('pending') }),
    run: async (a, fx) => { await a.put(`/api/mail/${fx.m.id}/approve`, {}); },
  },
  {
    id: 'm.foryou.mail.deliver', area: 'Mobile app', label: 'For you: deliver mail', where: 'mobile/ForYou.jsx (mail.deliver)', show: withMobile([['mail.deliver']]),
    setup: async (h) => ({ m: await h.mail('approved') }),
    run: async (a, fx) => { await a.put(`/api/mail/${fx.m.id}/deliver`, {}); },
  },
  {
    id: 'm.foryou.chore', area: 'Mobile app', label: 'For you: sign off a chore', where: 'mobile/ForYou.jsx (chores.log)', show: withMobile([['chores.log']]),
    setup: async (h) => {
      const c = await h.resident();
      await h.admin.patch(`/api/clients/${c.id}/chore`).send({ chore: 'Dishes', chore_time: 'PM' });
      return { resident: c };
    },
    run: async (a, fx) => { await a.put('/api/chore-log', { client_id: fx.resident.id, log_date: new Date().toLocaleDateString('en-CA'), initials: 'MU' }); },
  },
  {
    id: 'm.foryou.review', area: 'Mobile app', label: 'For you: review an infraction', where: 'mobile/ForYou.jsx → InfractionReviewSheet (violations.review)', show: withMobile([['violations.review']]),
    setup: async (h) => ({ v: await h.violation('pending') }),
    run: async (a, fx) => { await a.put(`/api/violations/${fx.v.id}/review`, { action: 'assign', consequence: 'Audit' }); },
  },
  {
    id: 'm.foryou.complete', area: 'Mobile app', label: 'For you: consequence Done', where: 'mobile/ForYou.jsx (can_complete = violations.complete)', show: withMobile([['violations.complete']]),
    setup: async (h) => ({ v: await h.violation('assigned') }),
    run: async (a, fx) => { await a.put(`/api/violations/${fx.v.id}/complete`, {}); },
  },
  {
    id: 'm.foryou.milestone', area: 'Mobile app', label: 'For you: sign off a milestone', where: 'mobile/ForYou.jsx (milestones.signoff)', show: withMobile([['milestones.signoff']]),
    setup: async (h) => ({ id: await h.milestone() }),
    run: async (a, fx) => { await a.put(`/api/milestones/${fx.id}/signoff`, {}); },
  },
  {
    id: 'm.quick.draw', area: 'Mobile app', label: 'Quick action: UA draw', where: 'mobile/ForYou.jsx QuickActions → UaDrawSheet (ua.draw)', show: withMobile([['ua.draw']]),
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => {
      await a.get('/api/ua-draws/recent-clients?days=30');
      await a.post('/api/ua-draws', { residents: [{ id: fx.resident.id, name: fx.resident.name, room: fx.resident.room }], method: 'smart' });
    },
  },
  {
    id: 'm.quick.infraction', area: 'Mobile app', label: 'Log an infraction (quick action or resident card)', where: 'mobile/sheets.jsx LogInfractionSheet (violations.log)', show: withMobile([['violations.log']]),
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.post('/api/violations', { client_id: fx.resident.id, client_name: fx.resident.name, room: fx.resident.room, violation_date: new Date().toLocaleDateString('en-CA'), description: 'Audit', staff_name: 'Sam Staff' }); },
  },
  {
    id: 'm.announce', area: 'Mobile app', label: 'Send an announcement', where: 'mobile/Announcements.jsx (broadcast.send)', show: withMobile([['broadcast.send']]),
    run: async (a) => { await a.post('/api/broadcasts', { message: 'Audit mobile announcement' }); },
  },
  {
    id: 'm.card.ua', area: 'Mobile app', label: 'Resident card: request a UA', where: 'mobile/Resident.jsx (ua.request)', show: withMobile([['ua.request']]),
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.post('/api/ua-requests', { client_id: fx.resident.id, client_name: fx.resident.name, room: String(fx.resident.room) }); },
  },
  {
    id: 'm.pin', area: 'Mobile app', label: 'Set up quick unlock (PIN)', where: 'mobile/More.jsx → PinSetupSheet', show: [[MOBILE]], freshUser: true,
    run: async (a) => { await a.post('/api/auth/pin/setup', { pin: '582917' }); },
  },
  {
    id: 'm.alerts', area: 'Mobile app', label: 'Alert settings (config, device, prefs, test)', where: 'mobile/More.jsx', show: [[MOBILE]],
    run: async (a) => {
      await a.get('/api/push/config');
      await a.post('/api/push/device', { endpoint: 'https://fcm.googleapis.com/fcm/send/audit-none' });
    },
  },

  // ── Classic mobile page (pages/Mobile.jsx) — needs mobile.access ──
  {
    id: 'classic.log', area: 'Classic mobile page', label: 'Wellness / walkthrough / log entries', where: 'Mobile.jsx (canLog)', show: [[MOBILE, 'log.add']],
    setup: async (h) => ({ id: await h.report() }),
    run: async (a, fx) => { await a.patch('/api/data', { reportId: fx.id, log_entry: { time: '11:30 AM', text: 'Audit classic entry' } }); },
  },
  {
    id: 'classic.ua', area: 'Classic mobile page', label: 'Request a UA', where: 'Mobile.jsx (ua.request)', show: [[MOBILE, 'ua.request']],
    setup: async (h) => ({ resident: await h.resident() }),
    run: async (a, fx) => { await a.post('/api/ua-requests', { client_id: fx.resident.id, client_name: fx.resident.name, room: fx.resident.room }); },
  },

  // ── Admin (pages/Admin.jsx) — reached from the gear menu, which needs admin.users ──
  {
    id: 'admin.users', area: 'Admin', label: 'Accounts: add, edit, protect, groups, delete', where: 'Admin.jsx — Accounts group (admin.users)', show: [['admin.users']],
    setup: async (h) => ({ uid: await h.user() }),
    run: async (a, fx) => {
      await a.get('/api/users');
      await a.post('/api/users', { username: `audit_new_${Date.now()}`, displayName: 'Audit New', password: 'Audit!Passw0rd8', role: 'pa', groupIds: [] });
      await a.put(`/api/users/${fx.uid}`, { displayName: 'Audit Edited' });
      await a.put(`/api/users/${fx.uid}/protect`, {});
      await a.put(`/api/users/${fx.uid}/protect`, {});
      await a.put(`/api/users/${fx.uid}/groups`, { groupIds: [] });
      await a.del(`/api/users/${fx.uid}`);
    },
  },
  {
    id: 'admin.groups', area: 'Admin', label: 'Permission groups: create, edit, delete', where: 'Admin.jsx — Permission Groups (admin.users)', show: [['admin.users']],
    setup: async (h) => ({ gid: await h.group() }),
    run: async (a, fx) => {
      await a.get('/api/groups');
      await a.post('/api/groups', { key: `audit_new_${Date.now()}`, label: 'Audit New', permissions: ['log.add'] });
      await a.put(`/api/groups/${fx.gid}`, { label: 'Audit Edited', permissions: ['log.add', 'log.delete'] });
      await a.del(`/api/groups/${fx.gid}`);
      const prof = await a.get('/api/permission-profiles');
      if (Array.isArray(prof.body)) await a.put('/api/permission-profiles', prof.body);
    },
  },
  {
    id: 'admin.settings', area: 'Admin', label: 'Facility settings (General, Statuses, Appearance, Features, Walk areas, UA panel, EHR)',
    where: 'Admin.jsx — Facility group (admin.settings); Admin itself needs admin.users', show: [['admin.users', 'admin.settings']],
    run: async (a) => {
      const cur = (await a.get('/api/facility/settings')).body || {};
      await a.put('/api/facility/settings', { facility_name: cur.facility_name || 'OpsPoint' });
      await a.put('/api/facility/ehr-config', { program_tracks: ['Audit Track'] });
    },
  },
  {
    id: 'admin.rooms', area: 'Admin', label: 'Rooms: add, rename, delete, reorder', where: 'Admin.jsx — Rooms (facility.manage); Admin needs admin.users', show: [['admin.users', 'facility.manage']],
    setup: async (h) => ({ id: await h.room(), del: await h.room() }),
    run: async (a, fx) => {
      await a.get('/api/facility/rooms');
      await a.post('/api/facility/rooms', { room: String(40000 + (++added)) });
      await a.put(`/api/facility/rooms/${fx.id}`, { room: String(50000 + fx.id) });
      await a.del(`/api/facility/rooms/${fx.del}`);
      await a.post('/api/facility/reorder', { order: [fx.id] });
    },
  },
  {
    id: 'admin.reset', area: 'Admin', label: 'Reset facility', where: 'Admin.jsx — Reset Facility (facility.manage)', show: [['admin.users', 'facility.manage']],
    staticRoute: ['POST', '/api/facility/reset'],
  },
  {
    id: 'admin.audit', area: 'Admin', label: 'Audit log', where: 'Admin.jsx — Audit Log (admin.audit); Admin needs admin.users', show: [['admin.users', 'admin.audit']],
    run: async (a) => { await a.get('/api/audit-log?limit=5'); },
  },
  {
    id: 'admin.system', area: 'Admin', label: 'System: health, update status, HQ status', where: 'Admin.jsx — System (admin.system), SystemHealth.jsx; Admin needs admin.users', show: [['admin.users', 'admin.system']],
    run: async (a) => {
      await a.get('/api/system/health');
      await a.get('/api/update/status');
      await a.get('/api/update/backups');
      await a.get('/api/central/status');
    },
  },
  ...[['POST', '/api/system/health/run', 'Run the health checks'], ['POST', '/api/system/health/dbkey-confirmed', 'Confirm the database key is stored elsewhere'],
    ['POST', '/api/admin/restart', 'Restart the server'], ['POST', '/api/update/check', 'Check for updates'], ['POST', '/api/update/apply', 'Install an update'],
    ['POST', '/api/update/rollback', 'Roll back an update'], ['POST', '/api/central/connect', 'Connect to HQ'], ['POST', '/api/central/disconnect', 'Disconnect from HQ'],
    ['POST', '/api/central/checkin', 'HQ check-in'], ['POST', '/api/central/sync-now', 'HQ sync now'], ['POST', '/api/central/auto-update', 'HQ auto-update setting']].map(([verb, path, name]) => ({
    id: `admin.system.${path}`, area: 'Admin', label: `System: ${name}`, where: 'Admin.jsx — System (admin.system)', show: [['admin.users', 'admin.system']], staticRoute: [verb, path],
  })),
  ...[['POST', '/api/central/manage-users', 'let HQ manage accounts'], ['POST', '/api/central/pull-users', 'pull accounts from HQ']].map(([verb, path, name]) => ({
    id: `admin.system.${path}`, area: 'Admin', label: `System: ${name}`, where: 'Admin.jsx — System panel (admin.system)', show: [['admin.users', 'admin.system']], staticRoute: [verb, path],
  })),

  // ── Your own account ──
  {
    id: 'account.password', area: 'Account', label: 'Change your own password', where: 'Admin.jsx / settings — "Change password"', show: EVERYONE, freshUser: true, reverse: false,
    run: async (a) => { await a.post('/api/users/me/password', { currentPassword: 'PermAudit!Passw0rd9', newPassword: 'PermAudit!Passw0rd8' }); },
  },
];
