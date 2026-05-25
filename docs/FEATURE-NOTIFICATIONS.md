# Notification Bell + UA Draws + Broadcast Messages
## ShiftPoint Implementation Guide

This document describes a full feature batch ported from OpsPoint. ShiftPoint already has
the group permissions system, the infractions workflow, and `infractions.notify_*` permissions —
so those don't need to be rebuilt. Everything below is **net-new** work.

---

## ✅ Implementation Checklist

Use this to track progress. Every item must be done for the system to work end-to-end.

### `db.js`
- [ ] Add `broadcast.send`, `broadcast.receive`, `ua.draw` to `PERMISSIONS` array
- [ ] Add those permissions to `ROLE_PRESETS` (monitor gets `broadcast.receive`; supervisor/admin get all three; case_manager gets `broadcast.send/receive`)
- [ ] Add `ua_draws` table in `_createSchema()`
- [ ] Add `broadcast_messages` table in `_createSchema()`
- [ ] Add `createUADraw`, `getUADraw`, `getUADraws`, `getRecentDrawnClientIds` functions
- [ ] Add `createBroadcast`, `getBroadcast`, `getBroadcasts` functions
- [ ] Export all new functions

### `server.js`
- [ ] Add `GET /api/ua-draws` route
- [ ] Add `GET /api/ua-draws/recent-clients` route
- [ ] Add `POST /api/ua-draws` route (creates draw + ua_requests, broadcasts `ua_draw_created`)
- [ ] Add `GET /api/broadcasts` route
- [ ] Add `POST /api/broadcasts` route (broadcasts `broadcast_message`)
- [ ] Update acknowledge route to broadcast `ua_request` after marking acknowledged

### `index.html`
- [ ] **Remove** `#ua-banner` div (lines ~276–279) and its CSS
- [ ] **Remove** `#infraction-banner` div (lines ~281–287) and its CSS
- [ ] Add `#notif-bell` button + `#notif-badge` span in `.header-actions` (before Sign Out)
- [ ] Add `#broadcast-btn` 📢 button next to bell (hidden unless `broadcast.send`)
- [ ] Add `#notif-overlay` div (full-screen click-away layer) — place just before `</body>`
- [ ] Add `#notif-panel` div (side panel) — place just before `</body>`, after overlay
- [ ] Add `#ua-draw-btn` in toolbar (alongside UA, Mail, Violation buttons)
- [ ] Add `#ua-draw-modal` div (modal-overlay)
- [ ] Add `#broadcast-modal` div (modal-overlay)
- [ ] Add all `.notif-*` CSS classes

### `js/app.js`
- [ ] Add `_getAudioCtx`, `_beep`, `playNotificationSound` (Web Audio, no external files)
- [ ] Add `_notifState` object (`uaRequests`, `uaDraws`, `violReview`, `violConsequence`, `broadcasts`)
- [ ] Add `updateNotifBell`, `toggleNotifPanel`, `openNotifPanel`, `closeNotifPanel`
- [ ] Add `_notifTimeAgo` helper
- [ ] Add `renderNotifPanel` (builds all sections as HTML)
- [ ] Add `dismissBroadcast` (base version; sync.js overrides it)
- [ ] Add/replace `_onInfractionsUpdated` (sound-gated; updates `_notifState`)
- [ ] Add `openUADrawModal`, `closeUADrawModal`, `previewUADraw`, `submitUADraw`
- [ ] Add `quickUAForClient` (pre-fills UA modal for a drawn client)
- [ ] Add `openBroadcastModal`, `closeBroadcastModal`, `sendBroadcast`
- [ ] Show/hide `#ua-draw-btn` and `#broadcast-btn` inside `applySettings()` based on permissions

### `js/sync.js`
- [ ] Add `_seenUARequestIds = new Set()` (prevents sound on ack)
- [ ] Add `_dismissedBroadcastIds` + localStorage helpers `_bcDismissKey`, `_loadDismissedBroadcasts`, `_saveDismissedBroadcasts`
- [ ] Override `window.dismissBroadcast` to persist to localStorage
- [ ] Replace `showUABanner` body with no-op stub (updates `_notifState`, no DOM banner)
- [ ] Replace `window.acknowledgeUA` with optimistic-removal version
- [ ] Update `ua_request` WS handler: ID-based `_seenUARequestIds` check (not count-based)
- [ ] Add `ua_draw_created` WS handler
- [ ] Add `broadcast_message` WS handler
- [ ] In `serverLoad`: fetch `/api/ua-requests`, `/api/ua-draws`, `/api/broadcasts`, infraction counts

### `admin.html`
- [ ] Add "Notifications" section to group permission editor with: `reminders.view`, `ua.acknowledge`, `infractions.notify_review`, `infractions.notify_consequence`, `broadcast.send`, `broadcast.receive`

---

## What Gets Built

1. **Unified Notification Bell** — replaces all inline banners (UA banner, infraction banner).
   A bell icon with a count badge lives in the header. Clicking it opens a side panel with
   collapsible sections: UA Requests, UA Draws (24h), Infractions alerts, and Announcements.
2. **Audible Notifications** — Web Audio API sounds for each event type; no external files.
3. **UA Random Draw** — history-aware random draw from eligible residents. Logged to DB.
   Drawn clients appear in the notification panel with a one-click "Log UA" shortcut.
4. **Broadcast Messages** — admins/supervisors/case managers can push announcements to
   monitors. Announcements appear in the notification bell. Can't be dismissed for 12 hours.
   Dismissals persist across page refreshes via localStorage.

---

## 1. Database (`db.js`)

### 1a. Add new permissions

In the `PERMISSIONS` array, add:
```javascript
'broadcast.send',    // compose and send an announcement
'broadcast.receive', // see announcements in the notification bell
'ua.draw',           // run the random UA draw
```

### 1b. Add to ROLE_PRESETS

```javascript
monitor:      [...existing..., 'broadcast.receive'],
supervisor:   [...existing..., 'broadcast.send', 'broadcast.receive', 'ua.draw'],
admin:        [...existing..., 'broadcast.send', 'broadcast.receive', 'ua.draw'],
case_manager: [...existing..., 'broadcast.send', 'broadcast.receive'],
```

### 1c. Create tables (inside `_createSchema()` / `init()` using try/catch ALTER pattern)

**`ua_draws` table:**
```sql
CREATE TABLE IF NOT EXISTS ua_draws (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  drawn_by    INTEGER NOT NULL,
  drawn_by_name TEXT NOT NULL,
  method      TEXT NOT NULL DEFAULT 'random',
  residents   TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)
```

**`broadcast_messages` table:**
```sql
CREATE TABLE IF NOT EXISTS broadcast_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   INTEGER NOT NULL,
  sender_name TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)
```

### 1d. Add helper functions

```javascript
// UA Draws
function createUADraw(drawnBy, drawnByName, residents) {
  // residents = [{id, name, room}, ...]
  const r = _run(
    `INSERT INTO ua_draws (drawn_by, drawn_by_name, method, residents)
     VALUES (?, ?, 'random', ?)`,
    [drawnBy, drawnByName, JSON.stringify(residents)]
  );
  return getUADraw(r.lastInsertRowid);
}
function getUADraw(id) {
  const row = _q1('SELECT * FROM ua_draws WHERE id=?', [id]);
  if (!row) return null;
  try { row.residents = JSON.parse(row.residents); } catch(e) { row.residents = []; }
  return row;
}
function getUADraws(sinceDateStr) {
  // sinceDateStr = ISO date string like '2026-05-14'
  const rows = _q(
    `SELECT * FROM ua_draws WHERE date(created_at) >= date(?) ORDER BY created_at DESC`,
    [sinceDateStr]
  );
  return rows.map(function(r) {
    try { r.residents = JSON.parse(r.residents); } catch(e) { r.residents = []; }
    return r;
  });
}
function getRecentDrawnClientIds(lookbackDays) {
  const since = new Date(Date.now() - lookbackDays * 86400000)
    .toISOString().slice(0, 10);
  const rows = _q(`SELECT residents FROM ua_draws WHERE date(created_at) >= date(?)`, [since]);
  const ids = new Set();
  rows.forEach(function(r) {
    try {
      JSON.parse(r.residents).forEach(function(c) { if (c.id) ids.add(c.id); });
    } catch(e) {}
  });
  return ids;
}

// Broadcasts
function createBroadcast(senderId, senderName, message) {
  const r = _run(
    `INSERT INTO broadcast_messages (sender_id, sender_name, message) VALUES (?, ?, ?)`,
    [senderId, senderName, message]
  );
  return getBroadcast(r.lastInsertRowid);
}
function getBroadcast(id) {
  return _q1('SELECT * FROM broadcast_messages WHERE id=?', [id]);
}
function getBroadcasts(limitHours) {
  // limitHours defaults to 24 — only show recent announcements
  const hours = limitHours || 24;
  return _q(
    `SELECT * FROM broadcast_messages
     WHERE created_at >= datetime('now', '-' || ? || ' hours')
     ORDER BY created_at DESC`,
    [hours]
  );
}
```

Export all four UA draw functions and both broadcast functions from the module's exports object.

---

## 2. Server (`server.js`)

### 2a. UA Draw routes

```javascript
// GET /api/ua-draws — recent draws (last 30 days by default)
app.get('/api/ua-draws', requireAuth, (req, res) => {
  const since = req.query.since ||
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  res.json(db.getUADraws(since));
});

// GET /api/ua-draws/recent-clients — IDs of clients drawn in the last N days
app.get('/api/ua-draws/recent-clients', requireAuth, requirePermission('ua.draw'), (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const ids = db.getRecentDrawnClientIds(days);
  res.json({ ids: Array.from(ids) });
});

// POST /api/ua-draws — create a new draw and auto-create ua_requests for drawn clients
app.post('/api/ua-draws', requireAuth, csrfCheck, requirePermission('ua.draw'), (req, res) => {
  const { residents } = req.body; // [{id, name, room}, ...]
  if (!Array.isArray(residents) || residents.length === 0)
    return res.status(400).json({ error: 'residents required' });

  const by   = req.session.displayName || req.session.username;
  const byId = req.session.userId;

  // Create the draw record
  const drawId = db.run(
    `INSERT INTO ua_draws (drawn_by, drawn_by_name, method, residents) VALUES (?,?,?,?)`,
    [byId, by, 'random', JSON.stringify(residents)]
  ).lastInsertRowid;

  // Create a ua_request for each drawn client
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  residents.forEach(function(c) {
    db.run(
      `INSERT INTO ua_requests (client_id,client_name,room,requested_by,is_interview,interview_name)
       VALUES (?,?,?,?,0,'')`,
      [c.id || 0, c.name || '', c.room || '', by]
    );
  });
  db.save();

  const draw    = db.getUADraw(drawId);
  const pending = db.query('SELECT * FROM ua_requests WHERE acknowledged=0 ORDER BY requested_at DESC');
  broadcast({ type: 'ua_draw_created', drawId, draw, requests: pending });
  res.json({ ok: true, drawId });
});
```

### 2b. Broadcast routes

```javascript
// GET /api/broadcasts
app.get('/api/broadcasts', requireAuth, (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  res.json(db.getBroadcasts(hours));
});

// POST /api/broadcasts
app.post('/api/broadcasts', requireAuth, csrfCheck, requirePermission('broadcast.send'), (req, res) => {
  const text = String(req.body.message || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'message required' });
  const msg = db.createBroadcast(
    req.session.userId,
    req.session.displayName || req.session.username,
    text
  );
  broadcast({ type: 'broadcast_message', message: msg });
  res.json({ ok: true, message: msg });
});
```

### 2c. Update the acknowledge route to broadcast the updated list

After marking a UA request as acknowledged, broadcast the updated pending list:
```javascript
const pending = db.query('SELECT * FROM ua_requests WHERE acknowledged=0 ORDER BY requested_at DESC');
broadcast({ type: 'ua_request', requests: pending });
res.json({ ok: true });
```
(This is needed so the notification bell updates on all sessions when one session acks.)

---

## 3. `index.html`

### 3a. Remove the old inline banners

The old banners are replaced entirely by the notification bell panel. Delete these two blocks
(around lines 276–287 in the current ShiftPoint `index.html`):

```html
<!-- DELETE THIS ENTIRE BLOCK -->
<div id="ua-banner" role="alert">
  <div id="ua-banner-items"></div>
  <button class="ua-banner-dismiss" onclick="acknowledgeAllUA()">&#10003; Acknowledge All</button>
</div>

<!-- DELETE THIS ENTIRE BLOCK -->
<div id="infraction-banner" role="alert">
  <div id="infraction-banner-msgs" ...></div>
  <div>...</div>
</div>
```

Also delete their CSS blocks (`#ua-banner { ... }` and `#infraction-banner { ... }`).

---

### 3b. Add the notification bell + broadcast button to the header

Inside `.header-actions`, **before** the Sign Out `<form>` tag (around line 255),
insert the bell and broadcast buttons:

```html
<div class="header-actions" style="flex-wrap:nowrap;gap:6px;">
  <!-- User info row: session, admin, sign out, save status -->
  <span id="session-user" ...></span>
  <span id="admin-link" ...></span>

  <!-- ▼ ADD THESE TWO BUTTONS HERE ▼ -->
  <button id="notif-bell" class="notif-bell-btn" onclick="toggleNotifPanel()" title="Notifications">
    🔔
    <span id="notif-badge" class="notif-badge" style="display:none;">0</span>
  </button>
  <button id="broadcast-btn" onclick="openBroadcastModal()" title="Send Announcement"
    style="display:none;background:none;border:none;cursor:pointer;font-size:1.1rem;padding:4px 6px;color:#fff;">
    📢
  </button>
  <!-- ▲ END ADD ▲ -->

  <form method="POST" action="/logout" ...>
    <button type="submit" ...>Sign Out</button>
  </form>
  ...
</div>
```

**Key points:**
- `#notif-bell` is always visible — `updateNotifBell()` sets it to `display:inline-flex` on load.
- `#notif-badge` starts hidden; `updateNotifBell()` shows it when count > 0.
- `#broadcast-btn` starts hidden; shown by `applySettings()` when user has `broadcast.send`.

---

### 3c. Add the notification overlay and panel

Place these **just before `</body>`** (after all modals). The overlay is a full-screen
click-away layer; the panel slides in from the right.

```html
<!-- Notification overlay (click-away to close panel) -->
<div id="notif-overlay" class="notif-overlay" onclick="closeNotifPanel()"></div>

<!-- Notification side panel -->
<div id="notif-panel" class="notif-panel">
  <div class="notif-panel-head">
    <span>🔔 Notifications</span>
    <button class="xbtn" onclick="closeNotifPanel()">✕ Close</button>
  </div>
  <div id="notif-panel-body"></div>
</div>
```

---

### 3d. Add the UA Draw button in the toolbar (shown only to users with ua.draw)

Add alongside the other quick-action buttons (UA, Mail, Violation, etc.):
```html
<button id="ua-draw-btn" class="qbtn qbtn-ua-draw" onclick="openUADrawModal()" style="display:none;">🎲 UA Draw</button>
```

### 3e. Add the UA Draw modal

```html
<div id="ua-draw-modal" class="modal-overlay">
  <div class="modal">
    <button class="xbtn" onclick="closeUADrawModal()">×</button>
    <h3>Random UA Draw</h3>
    <div id="ua-draw-options">
      <label>
        <input type="checkbox" id="ua-draw-exclude" checked>
        Exclude residents drawn in the last
        <input type="number" id="ua-draw-lookback" value="30" min="1" max="365" style="width:50px;">
        days
      </label>
      <br>
      <label>
        Draw
        <input type="number" id="ua-draw-count" value="5" min="1" max="50" style="width:50px;">
        residents
      </label>
    </div>
    <div id="ua-draw-pool-info" style="margin:8px 0;font-size:.85rem;color:#64748B;"></div>
    <div id="ua-draw-results" style="margin:12px 0;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button class="btn btn-outline" onclick="closeUADrawModal()">Cancel</button>
      <button class="btn btn-primary" onclick="previewUADraw()">Preview Draw</button>
      <button class="btn btn-primary" id="ua-draw-submit-btn" onclick="submitUADraw()" style="display:none;">Confirm & Send</button>
    </div>
  </div>
</div>
```

### 3f. Add the broadcast compose modal

```html
<div id="broadcast-modal" class="modal-overlay">
  <div class="modal">
    <button class="xbtn" onclick="closeBroadcastModal()">×</button>
    <h3>📢 Send Announcement</h3>
    <textarea id="broadcast-text" maxlength="500" rows="4"
      style="width:100%;resize:vertical;"
      oninput="document.getElementById('broadcast-chars').textContent=this.value.length+' / 500';"
      placeholder="Type your announcement…"></textarea>
    <div id="broadcast-chars" style="text-align:right;font-size:.75rem;color:#94A3B8;margin-bottom:8px;">0 / 500</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-outline" onclick="closeBroadcastModal()">Cancel</button>
      <button class="btn btn-primary" onclick="sendBroadcast()">Send</button>
    </div>
  </div>
</div>
```

### 3g. Add required CSS

Add this CSS block in `<style>` in `index.html` (or in a linked `.css` file).
Make sure the `z-index` values are higher than any existing modals.

```css
/* ── Notification Bell ─────────────────────────────────── */
.notif-bell-btn {
  position: relative;
  display: inline-flex;       /* always visible; badge hides when count = 0 */
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.2rem;
  padding: 4px 8px;
  color: #fff;
  border-radius: 6px;
}
.notif-bell-btn:hover { background: rgba(255,255,255,.12); }

.notif-badge {
  position: absolute;
  top: 0; right: 0;
  background: #EF4444;
  color: #fff;
  border-radius: 999px;
  font-size: .65rem;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  display: flex;             /* toggled by updateNotifBell() */
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  pointer-events: none;
}

/* ── Overlay (click-away layer behind the panel) ─────────── */
.notif-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 1100;             /* below panel (1101), above page content */
  background: transparent;
}
.notif-overlay.open { display: block; }

/* ── Side panel (slides in from right) ───────────────────── */
.notif-panel {
  position: fixed;
  top: 0; right: -380px;    /* off-screen when closed */
  width: 360px;
  max-width: 95vw;
  height: 100vh;
  background: #fff;
  box-shadow: -4px 0 24px rgba(0,0,0,.18);
  z-index: 1101;             /* above overlay */
  display: flex;
  flex-direction: column;
  transition: right .22s ease;
  overflow: hidden;
}
.notif-panel.open { right: 0; }

.notif-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: #1B2F6E;       /* navy — matches ShiftPoint theme */
  color: #fff;
  font-weight: 700;
  font-size: 1rem;
  flex-shrink: 0;
}

#notif-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

/* ── Section headers ─────────────────────────────────────── */
.notif-section { border-bottom: 1px solid #E2E8F0; }

.notif-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px 6px;
  font-weight: 700;
  font-size: .8rem;
  letter-spacing: .04em;
  color: #475569;
  text-transform: uppercase;
  cursor: pointer;
  user-select: none;
}

.notif-section-count {
  background: #EF4444;
  color: #fff;
  border-radius: 999px;
  font-size: .7rem;
  font-weight: 700;
  min-width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
}

/* ── Individual notification rows ────────────────────────── */
.notif-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-top: 1px solid #F1F5F9;
}
.notif-item-icon { font-size: 1.2rem; flex-shrink: 0; }
.notif-item-body { flex: 1; min-width: 0; }
.notif-item-name { font-weight: 600; font-size: .85rem; color: #1E293B; }
.notif-item-meta { font-size: .72rem; color: #64748B; margin-top: 2px; }

.notif-item-action {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #CBD5E1;
  background: #fff;
  font-size: .78rem;
  cursor: pointer;
  font-weight: 600;
  white-space: nowrap;
}
.notif-item-action:hover { background: #F1F5F9; }

/* ── All-clear state ─────────────────────────────────────── */
.notif-all-clear {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
  color: #64748B;
  font-size: .9rem;
  text-align: center;
}
.notif-all-clear-icon { font-size: 2rem; }

/* ── Also update @media print to exclude new elements ─────── */
/* Add to existing print media query: */
/* #notif-bell, #notif-overlay, #notif-panel, #broadcast-btn { display: none !important; } */
```

---

## 4. `js/app.js`

### 4a. Add the Web Audio sound system

Add near the top of app.js (outside any function):
```javascript
var _audioCtx = null;
function _getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch(e) { _audioCtx = null; }
  return _audioCtx;
}
// Warm up AudioContext on first user interaction (browser autoplay policy)
document.addEventListener('click',   function() { _getAudioCtx(); }, { once: true });
document.addEventListener('keydown',  function() { _getAudioCtx(); }, { once: true });

function _beep(ctx, freq, delay, duration, wave, vol) {
  try {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = wave || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.3, ctx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    o.start(ctx.currentTime + delay);
    o.stop(ctx.currentTime + delay + duration + 0.05);
  } catch(e) {}
}

function playNotificationSound(type) {
  var ctx = _getAudioCtx(); if (!ctx) return;
  try {
    if (type === 'ua') {
      // Three sharp beeps
      _beep(ctx, 900, 0,   .08, 'square', .25);
      _beep(ctx, 900, .12, .08, 'square', .25);
      _beep(ctx, 900, .24, .08, 'square', .25);
    } else if (type === 'infraction-review') {
      // Descending two-tone chime (case manager: new infraction to review)
      _beep(ctx, 660, 0,  .18, 'sine', .3);
      _beep(ctx, 440, .2, .28, 'sine', .3);
    } else if (type === 'infraction-consequence') {
      // Ascending two-tone chime (monitor: consequence assigned, action needed)
      _beep(ctx, 440, 0,  .18, 'sine', .3);
      _beep(ctx, 554, .2, .28, 'sine', .3);
    } else if (type === 'broadcast') {
      // Two-note fanfare
      _beep(ctx, 523, 0,  .15, 'sine', .22);
      _beep(ctx, 659, .2, .25, 'sine', .22);
    }
  } catch(e) {}
}
```

### 4b. Add `_notifState` and the notification bell functions

```javascript
// ── Notification Center ──────────────────────────────────────────
var _notifState = {
  uaRequests:     [],
  uaDraws:        [],
  violReview:     0,
  violConsequence: 0,
  broadcasts:     [],
};
var _notifPanelOpen = false;

function updateNotifBell() {
  var bell  = document.getElementById('notif-bell');
  var badge = document.getElementById('notif-badge');
  if (!bell) return;
  var total = _notifState.uaRequests.length
            + _notifState.uaDraws.length
            + (_notifState.violReview > 0 ? 1 : 0)
            + (_notifState.violConsequence > 0 ? 1 : 0)
            + _notifState.broadcasts.length;
  bell.style.display = 'inline-flex';
  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
  if (_notifPanelOpen) renderNotifPanel();
}

function toggleNotifPanel() { _notifPanelOpen ? closeNotifPanel() : openNotifPanel(); }

function openNotifPanel() {
  _notifPanelOpen = true;
  renderNotifPanel();
  document.getElementById('notif-panel').classList.add('open');
  document.getElementById('notif-overlay').classList.add('open');
}

function closeNotifPanel() {
  _notifPanelOpen = false;
  document.getElementById('notif-panel').classList.remove('open');
  document.getElementById('notif-overlay').classList.remove('open');
}

// Time-ago helper for panel
function _notifTimeAgo(ts) {
  if (!ts) return '';
  var t   = new Date(ts.replace ? ts.replace(' ', 'T') + 'Z' : ts);
  var sec = Math.floor((Date.now() - t.getTime()) / 1000);
  if (sec < 60)  return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  return Math.floor(sec / 86400) + 'd ago';
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderNotifPanel() {
  var body = document.getElementById('notif-panel-body');
  if (!body) return;
  var html = '', hasAny = false;

  // ── Section: UA Requests ──
  var uaReqs = _notifState.uaRequests || [];
  if (uaReqs.length > 0) {
    hasAny = true;
    html += '<div class="notif-section">';
    html += '<div class="notif-section-head">🧡 UA Requests<span class="notif-section-count">' + uaReqs.length + '</span></div>';
    html += '<div>';
    uaReqs.forEach(function(r) {
      var name = r.interview_name || r.client_name || 'Interview';
      var room = r.room ? ' · Rm. ' + r.room : '';
      var ago  = _notifTimeAgo(r.requested_at);
      var cid  = parseInt(r.client_id) || 0;
      html += '<div class="notif-item">';
      html += '<span class="notif-item-icon">🧪</span>';
      html += '<div class="notif-item-body"><div class="notif-item-name">' + _esc(name) + '</div>';
      html += '<div class="notif-item-meta">' + _esc(room) + ' &nbsp;' + _esc(ago) + '</div></div>';
      html += '<div style="display:flex;gap:4px;flex-shrink:0;">';
      if (cid) {
        html += '<button class="notif-item-action" style="background:#1B2F6E;color:#fff;" '
              + 'onclick="closeNotifPanel();quickUAForClient(' + cid + ',\''
              + _esc(r.client_name || '') + '\',\'' + _esc(r.room || '') + '\')">🧪 Log</button>';
      }
      html += '<button class="notif-item-action" onclick="acknowledgeUA(' + parseInt(r.id) + ')">✔ Ack</button>';
      html += '</div></div>';
    });
    html += '</div></div>';
  }

  // ── Section: UA Draws (last 24 hours) ──
  var _24hAgo = Date.now() - 24 * 3600000;
  var draws = (_notifState.uaDraws || []).filter(function(d) {
    var ts = d.created_at ? new Date(d.created_at.replace(' ', 'T') + 'Z').getTime() : 0;
    return ts >= _24hAgo;
  });
  if (draws.length > 0) {
    hasAny = true;
    html += '<div class="notif-section">';
    html += '<div class="notif-section-head" onclick="this.nextElementSibling.classList.toggle(\'hide\')">🎲 UA Draws (24h)<span class="notif-section-count">' + draws.length + '</span></div>';
    html += '<div>';
    draws.forEach(function(d) {
      var cnt = Array.isArray(d.residents) ? d.residents.length : 0;
      var by  = d.drawn_by_name || 'Staff';
      var ago = _notifTimeAgo(d.created_at);
      html += '<div class="notif-item">';
      html += '<span class="notif-item-icon">📋</span>';
      html += '<div class="notif-item-body"><div class="notif-item-name">' + cnt + ' resident' + (cnt !== 1 ? 's' : '') + ' selected</div>';
      html += '<div class="notif-item-meta">By ' + _esc(by) + ' · ' + _esc(d.method) + ' · ' + _esc(ago) + '</div>';
      if (Array.isArray(d.residents) && d.residents.length > 0) {
        html += '<div style="font-size:.73rem;color:#475569;margin-top:3px;">';
        html += d.residents.slice(0, 5).map(function(r) { return 'Rm.' + r.room + ' ' + r.name; }).join(', ');
        if (d.residents.length > 5) html += '…';
        html += '</div>';
      }
      html += '</div></div>';
    });
    html += '</div></div>';
  }

  // ── Section: Infractions pending review (notify_review users only) ──
  if (_notifState.violReview > 0 && SESSION.permissions.includes('infractions.notify_review')) {
    hasAny = true;
    html += '<div class="notif-section">';
    html += '<div class="notif-section-head">🔴 Infractions: Pending Review<span class="notif-section-count">' + _notifState.violReview + '</span></div>';
    html += '<div class="notif-item"><span class="notif-item-icon">⚠️</span>';
    html += '<div class="notif-item-body"><div class="notif-item-name">' + _notifState.violReview + ' infraction' + (_notifState.violReview !== 1 ? 's' : '') + ' awaiting review</div>';
    html += '<div class="notif-item-meta">Case conference needed</div></div>';
    html += '<button class="notif-item-action" onclick="switchTab(\'infractions\');closeNotifPanel();">View</button>';
    html += '</div></div>';
  }

  // ── Section: Infractions consequence assigned (notify_consequence users only) ──
  if (_notifState.violConsequence > 0 && SESSION.permissions.includes('infractions.notify_consequence')) {
    hasAny = true;
    html += '<div class="notif-section">';
    html += '<div class="notif-section-head">🟠 Infractions: Consequence Assigned<span class="notif-section-count">' + _notifState.violConsequence + '</span></div>';
    html += '<div class="notif-item"><span class="notif-item-icon">📌</span>';
    html += '<div class="notif-item-body"><div class="notif-item-name">' + _notifState.violConsequence + ' consequence' + (_notifState.violConsequence !== 1 ? 's' : '') + ' need completion</div>';
    html += '<div class="notif-item-meta">Assigned to resident</div></div>';
    html += '<button class="notif-item-action" onclick="switchTab(\'infractions\');closeNotifPanel();">View</button>';
    html += '</div></div>';
  }

  // ── Section: Announcements ──
  var bcasts = _notifState.broadcasts || [];
  if (bcasts.length > 0 && SESSION.permissions.includes('broadcast.receive')) {
    hasAny = true;
    html += '<div class="notif-section">';
    html += '<div class="notif-section-head" onclick="this.nextElementSibling.classList.toggle(\'hide\')">📢 Announcements<span class="notif-section-count">' + bcasts.length + '</span></div>';
    html += '<div>';
    bcasts.forEach(function(b) {
      var ago = _notifTimeAgo(b.created_at);
      var bcTs = b.created_at ? new Date(b.created_at.replace(' ', 'T') + 'Z').getTime() : 0;
      var canDismiss = bcTs > 0 && (Date.now() - bcTs) > 12 * 3600000;
      html += '<div class="notif-item" style="flex-direction:column;align-items:flex-start;gap:4px;">';
      html += '<div style="display:flex;width:100%;align-items:center;gap:8px;">';
      html += '<span class="notif-item-icon">📢</span>';
      html += '<div class="notif-item-body" style="flex:1;"><div class="notif-item-name" style="white-space:normal;">' + _esc(b.message) + '</div>';
      html += '<div class="notif-item-meta">From ' + _esc(b.sender_name) + ' &nbsp;' + _esc(ago) + '</div></div>';
      if (canDismiss) {
        html += '<button class="notif-item-action" onclick="dismissBroadcast(' + parseInt(b.id) + ')" title="Dismiss">✕</button>';
      } else {
        html += '<span style="font-size:.65rem;color:#94A3B8;flex-shrink:0;text-align:center;line-height:1.2;">dismissable<br>after 12h</span>';
      }
      html += '</div></div>';
    });
    html += '</div></div>';
  }

  if (!hasAny) {
    html = '<div class="notif-all-clear"><span class="notif-all-clear-icon">✅</span><span class="notif-all-clear-text">All clear — no pending notifications</span></div>';
  }
  body.innerHTML = html;
}

function dismissBroadcast(id) {
  // Base implementation — sync.js overrides this to also persist to localStorage
  _notifState.broadcasts = _notifState.broadcasts.filter(function(b) { return b.id !== id; });
  updateNotifBell();
}
```

### 4c. Replace `_onInfractionsUpdated` (already called by sync.js)

```javascript
var _prevViolReview = -1, _prevViolConsequence = -1;

function _onInfractionsUpdated(pendingReview, pendingConsequences) {
  var perms = (window.SESSION && window.SESSION.permissions) || [];
  var notifyReview      = perms.includes('infractions.notify_review');
  var notifyConsequence = perms.includes('infractions.notify_consequence');

  // Sound only when counts go UP from a known baseline (never on initial load)
  if (notifyReview && pendingReview > 0 && pendingReview > _prevViolReview && _prevViolReview >= 0)
    playNotificationSound('infraction-review');
  if (notifyConsequence && pendingConsequences > 0 && pendingConsequences > _prevViolConsequence && _prevViolConsequence >= 0)
    playNotificationSound('infraction-consequence');

  _prevViolReview      = pendingReview;
  _prevViolConsequence = pendingConsequences;
  _notifState.violReview      = pendingReview;
  _notifState.violConsequence = pendingConsequences;
  updateNotifBell();
}
```

### 4d. Add UA Draw modal functions

```javascript
var _uaDrawPreview = []; // holds the current previewed draw

function openUADrawModal() {
  _uaDrawPreview = [];
  var res = document.getElementById('ua-draw-results');
  var sub = document.getElementById('ua-draw-submit-btn');
  var inf = document.getElementById('ua-draw-pool-info');
  if (res) res.innerHTML = '';
  if (sub) sub.style.display = 'none';
  if (inf) inf.textContent = '';
  document.getElementById('ua-draw-modal').classList.add('open');
}

function closeUADrawModal() {
  document.getElementById('ua-draw-modal').classList.remove('open');
}

function _buildEligiblePool(excludeRecentIds) {
  // Build from active, non-vacant, non-special clients who are IN BUILDING
  // Adjust status check to match whatever values your STATUS_OPTS uses for "present"
  return (CLIENTS || []).filter(function(c) {
    if (!c.is_active || c.is_special || c.name === 'VACANT') return false;
    if (excludeRecentIds && excludeRecentIds.has(c.id)) return false;
    var st = shiftStatuses[c.id] || '';
    // Exclude clients who are on pass, at work, at hospital, or otherwise out of building
    var absent = ['pass', 'work', 'hospital', 'out'];
    return !absent.includes(st);
  });
}

function previewUADraw() {
  var exclude   = document.getElementById('ua-draw-exclude').checked;
  var lookback  = parseInt(document.getElementById('ua-draw-lookback').value) || 30;
  var drawCount = parseInt(document.getElementById('ua-draw-count').value) || 5;
  var inf = document.getElementById('ua-draw-pool-info');
  var res = document.getElementById('ua-draw-results');
  var sub = document.getElementById('ua-draw-submit-btn');

  if (exclude) {
    fetch('/api/ua-draws/recent-clients?days=' + lookback, { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var excSet = new Set((d.ids || []).map(Number));
        _runPreview(excSet, drawCount);
      }).catch(function() { _runPreview(new Set(), drawCount); });
  } else {
    _runPreview(new Set(), drawCount);
  }

  function _runPreview(excludeIds, n) {
    var pool = _buildEligiblePool(excludeIds);
    if (inf) inf.textContent = 'Pool: ' + pool.length + ' eligible resident' + (pool.length !== 1 ? 's' : '');
    if (pool.length === 0) {
      if (res) res.innerHTML = '<em style="color:#EF4444;">No eligible residents in the pool.</em>';
      if (sub) sub.style.display = 'none';
      _uaDrawPreview = [];
      return;
    }
    // Fisher-Yates shuffle, take first n
    var shuffled = pool.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }
    _uaDrawPreview = shuffled.slice(0, n).map(function(c) {
      return { id: c.id, name: c.name, room: c.room };
    });
    if (res) {
      res.innerHTML = '<strong>Selected (' + _uaDrawPreview.length + '):</strong><ul style="margin:6px 0 0 16px;">'
        + _uaDrawPreview.map(function(c) {
            return '<li>Rm. ' + c.room + ' — ' + c.name + '</li>';
          }).join('')
        + '</ul>';
    }
    if (sub) sub.style.display = _uaDrawPreview.length > 0 ? '' : 'none';
  }
}

function submitUADraw() {
  if (!_uaDrawPreview || _uaDrawPreview.length === 0) return;
  var sub = document.getElementById('ua-draw-submit-btn');
  if (sub) { sub.disabled = true; sub.textContent = 'Sending…'; }
  fetch('/api/ua-draws', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ residents: _uaDrawPreview })
  }).then(function(r) {
    if (r.ok) {
      closeUADrawModal();
      showToast('saved', '🎲 UA draw sent — ' + _uaDrawPreview.length + ' residents selected');
    } else {
      showToast('err', 'Draw failed (' + r.status + ')');
    }
  }).catch(function() {
    showToast('err', 'Draw failed — check connection');
  }).finally(function() {
    if (sub) { sub.disabled = false; sub.textContent = 'Confirm & Send'; }
  });
}

// Opens the UA modal pre-filled for a specific client with reason "Random"
function quickUAForClient(clientId, clientName, room) {
  quickUA(); // opens the standard quick-UA modal
  setTimeout(function() {
    var sel = document.getElementById('qm-client-sel');
    if (sel) { sel.value = String(clientId); sel.dispatchEvent(new Event('change')); }
    var reason = document.getElementById('qm-reason');
    if (reason) { reason.value = 'Random'; reason.dispatchEvent(new Event('change')); }
  }, 80);
}
```

### 4e. Add broadcast modal functions

```javascript
function openBroadcastModal() {
  var ta = document.getElementById('broadcast-text');
  var ch = document.getElementById('broadcast-chars');
  if (ta) ta.value = '';
  if (ch) ch.textContent = '0 / 500';
  document.getElementById('broadcast-modal').classList.add('open');
}

function closeBroadcastModal() {
  document.getElementById('broadcast-modal').classList.remove('open');
}

function sendBroadcast() {
  var ta  = document.getElementById('broadcast-text');
  var msg = ta ? ta.value.trim() : '';
  if (!msg) return;
  fetch('/api/broadcasts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ message: msg })
  }).then(function(r) {
    if (r.ok) {
      closeBroadcastModal();
      showToast('saved', '📢 Announcement sent');
    } else {
      showToast('err', 'Failed to send announcement (' + r.status + ')');
    }
  }).catch(function() { showToast('err', 'Send failed — check connection'); });
}
```

### 4f. Show/hide draw and broadcast buttons based on permissions

Inside `applySettings()` (or wherever you apply `ui_visibility`), add:
```javascript
// UA Draw button — requires ua.draw permission
var drawBtn = document.getElementById('ua-draw-btn');
if (drawBtn) {
  drawBtn.style.display = SESSION.permissions.includes('ua.draw') ? '' : 'none';
}
// Broadcast button — requires broadcast.send permission
var bcBtn = document.getElementById('broadcast-btn');
if (bcBtn) {
  bcBtn.style.display = SESSION.permissions.includes('broadcast.send') ? '' : 'none';
}
```

---

## 5. `js/sync.js`

### 5a. Add seen-ID tracking and broadcast dismissal persistence

Add near the top of the IIFE (after existing `var` declarations):
```javascript
// Track which UA request IDs we've already alerted on — prevents sound re-firing on ack
var _seenUARequestIds = new Set();

// Persist dismissed broadcast IDs to localStorage
var _dismissedBroadcastIds = new Set();

function _bcDismissKey() {
  return 'sp_dis_bc_' + ((window.SESSION && window.SESSION.username) || '');
}
function _loadDismissedBroadcasts() {
  try {
    var saved = JSON.parse(localStorage.getItem(_bcDismissKey()) || '[]');
    _dismissedBroadcastIds = new Set(saved.map(Number));
  } catch(e) { _dismissedBroadcastIds = new Set(); }
}
function _saveDismissedBroadcasts() {
  try { localStorage.setItem(_bcDismissKey(), JSON.stringify(Array.from(_dismissedBroadcastIds))); }
  catch(e) {}
}

// Override app.js dismissBroadcast to also persist
window.dismissBroadcast = function(id) {
  _dismissedBroadcastIds.add(parseInt(id));
  _saveDismissedBroadcasts();
  if (typeof _notifState !== 'undefined') {
    _notifState.broadcasts = (_notifState.broadcasts || []).filter(function(b) { return b.id !== parseInt(id); });
    if (typeof updateNotifBell === 'function') updateNotifBell();
  }
};
```

### 5b. Replace the `showUABanner` function with a no-op stub

```javascript
// showUABanner: UA requests now live in the notification bell, not a banner.
function showUABanner(requests) {
  if (typeof _notifState !== 'undefined') _notifState.uaRequests = requests || [];
  if (typeof updateNotifBell === 'function') updateNotifBell();
}
```

### 5c. Replace `acknowledgeUA` with optimistic-removal version

```javascript
window.acknowledgeUA = function(id) {
  // Optimistically remove so panel updates immediately
  if (typeof _notifState !== 'undefined') {
    _notifState.uaRequests = (_notifState.uaRequests || []).filter(function(r) {
      return r.id !== parseInt(id);
    });
    if (typeof updateNotifBell === 'function') updateNotifBell();
  }
  fetch('/api/ua-requests/' + parseInt(id) + '/acknowledge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include'
  }).catch(function() {});
};
```

### 5d. Update the WebSocket `onmessage` handler

Replace or update the relevant branches:

```javascript
// ── ua_request ──
} else if (msg.type === 'ua_request') {
  var _uaRequests = msg.requests || [];
  // Sound only for genuinely new IDs (ack doesn't introduce new IDs → no sound on ack)
  var _hasNewUA = _uaRequests.some(function(r) { return !_seenUARequestIds.has(r.id); });
  _seenUARequestIds = new Set(_uaRequests.map(function(r) { return r.id; }));
  if (typeof _notifState !== 'undefined') _notifState.uaRequests = _uaRequests;
  if (typeof updateNotifBell === 'function') updateNotifBell();
  if (typeof playNotificationSound === 'function' && _hasNewUA) playNotificationSound('ua');

// ── ua_draw_created ──
} else if (msg.type === 'ua_draw_created') {
  if (typeof _notifState !== 'undefined' && msg.draw) {
    _notifState.uaDraws = (_notifState.uaDraws || []).filter(function(d) { return d.id !== msg.draw.id; });
    _notifState.uaDraws.push(msg.draw);
  }
  if (typeof _notifState !== 'undefined' && msg.requests) {
    _notifState.uaRequests = msg.requests;
    // Mark new request IDs as seen so a follow-up ua_request WS event doesn't double-fire sound
    (msg.requests || []).forEach(function(r) { _seenUARequestIds.add(r.id); });
  }
  if (typeof updateNotifBell === 'function') updateNotifBell();
  if (typeof playNotificationSound === 'function') playNotificationSound('ua');

// ── broadcast_message ──
} else if (msg.type === 'broadcast_message') {
  if (typeof _notifState !== 'undefined' && msg.message && !_dismissedBroadcastIds.has(msg.message.id)) {
    _notifState.broadcasts = (_notifState.broadcasts || []).filter(function(b) { return b.id !== msg.message.id; });
    _notifState.broadcasts.unshift(msg.message);
    if (typeof updateNotifBell === 'function') updateNotifBell();
    if (typeof playNotificationSound === 'function') playNotificationSound('broadcast');
  }

// ── infractions_updated (already present — just make sure it calls _onInfractionsUpdated) ──
} else if (msg.type === 'infractions_updated') {
  var infTab = document.getElementById('tab-infractions');
  if (infTab && infTab.classList.contains('active')) loadInfractions();
  if (typeof _onInfractionsUpdated === 'function')
    _onInfractionsUpdated(msg.pendingReview || 0, msg.pendingConsequences || 0);
```

### 5e. Update `serverLoad` to fetch UA requests, draws, and broadcasts

Add after the main data load:
```javascript
// Load pending UA requests
fetch('/api/ua-requests', { credentials: 'include' }).then(function(r) { return r.json(); }).then(function(list) {
  if (typeof _notifState !== 'undefined') _notifState.uaRequests = list || [];
  // Seed seen-IDs so existing requests don't trigger sound on page load
  (list || []).forEach(function(r) { _seenUARequestIds.add(r.id); });
  if (typeof updateNotifBell === 'function') updateNotifBell();
}).catch(function() {});

// Load recent UA draws (24h)
var drawSince = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
fetch('/api/ua-draws?since=' + drawSince, { credentials: 'include' }).then(function(r) { return r.json(); }).then(function(draws) {
  if (typeof _notifState !== 'undefined') {
    _notifState.uaDraws = draws || [];
    if (typeof updateNotifBell === 'function') updateNotifBell();
  }
}).catch(function() {});

// Load recent broadcasts (filtered by already-dismissed IDs)
_loadDismissedBroadcasts();
fetch('/api/broadcasts', { credentials: 'include' }).then(function(r) { return r.json(); }).then(function(list) {
  var active = (list || []).filter(function(b) { return !_dismissedBroadcastIds.has(b.id); });
  if (typeof _notifState !== 'undefined') {
    _notifState.broadcasts = active;
    if (typeof updateNotifBell === 'function') updateNotifBell();
  }
}).catch(function() {});

// Load infraction counts for initial notification state
Promise.all([
  fetch('/api/infractions?status=pending',  { credentials: 'include' }).then(function(r) { return r.json(); }),
  fetch('/api/infractions?status=assigned', { credentials: 'include' }).then(function(r) { return r.json(); })
]).then(function(results) {
  var pending  = Array.isArray(results[0]) ? results[0].length : 0;
  var assigned = Array.isArray(results[1]) ? results[1].length : 0;
  if (typeof _onInfractionsUpdated === 'function') _onInfractionsUpdated(pending, assigned);
}).catch(function() {});
```

---

## 6. `admin.html` — Notifications Category

In the permission profile / group editor, create a **Notifications** section containing:

| Permission key | Label |
|---|---|
| `reminders.view` | Wellness / Walkthrough Reminder timers |
| `ua.acknowledge` | View & acknowledge UA requests |
| `infractions.notify_review` | Notify: New infraction logged (pending review) |
| `infractions.notify_consequence` | Notify: Consequence assigned (needs completion) |
| `broadcast.send` | Send announcements to staff |
| `broadcast.receive` | Receive announcements |

Move `reminders.view` out of the Shift Reports section and `ua.acknowledge` out of the UA section if they were there previously.

---

## 7. Behavior Notes

- **Sound gating:** Sounds play only when a genuinely new item arrives. Acknowledging a UA request
  sends a WS `ua_request` with the remaining requests — all their IDs are already in
  `_seenUARequestIds`, so `_hasNewUA` is false and no sound fires.
- **Infraction sound gating:** `_prevViolReview` and `_prevViolConsequence` start at `-1`.
  `_onInfractionsUpdated` is called on initial page load with the current counts, which sets
  the baseline. Subsequent calls only play sound when counts increase above that baseline.
- **Broadcast 12-hour lock:** Announcements show "dismissable after 12h" until 12 hours have
  passed since `created_at`. After that the ✕ button appears.
- **Broadcast persistence:** Dismissed broadcast IDs are saved to `localStorage` under
  `sp_dis_bc_<username>`. On every page load, dismissed IDs are filtered out before
  populating the panel, so dismissed announcements never come back.
- **UA Draw pool:** The pool builder uses `shiftStatuses[c.id]` (a bare string) to determine
  presence. Absent statuses to exclude: `'pass'`, `'work'`, `'hospital'`, `'out'` — adjust
  these to match your actual `STATUS_OPTS` values.
- **`quickUAForClient`:** This function depends on your existing `quickUA()` function opening
  a modal with elements `#qm-client-sel` (a `<select>`) and `#qm-reason` (a text or select
  input). Adjust selectors if your modal uses different IDs.
