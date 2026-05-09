# CLAUDE.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Commands

```bash
# Install dependencies (first time only)
npm install

# Run the server
node server.js
# or
npm start

# Syntax check a JS file without running it
node --check server.js
node --check js/tabs.js
```

There are no tests, no linter config, and no build step. The frontend is plain HTML/CSS/JS served directly by Express — no transpilation.

The server starts on port 3000 and auto-opens a browser tab. It prints the LAN IP for mobile access.

## Architecture

### Server (`server.js`)
Express + `ws` WebSocket server. Handles auth, all API routes, and real-time broadcast. Three middleware guards used on routes:
- `requireAuth` — any logged-in user
- `requireSup` — supervisor or admin
- `requireAdmin` — admin only

Every write route calls `db.save()` then `broadcast({type: '...'})`. The WebSocket is authentication-gated at the handshake level. Clients can only receive — incoming WS messages are dropped.

`window.SESSION` is injected into served HTML pages by `injectSession()` before the `</head>` tag. This is how the frontend knows the current user's role.

**Security details:** Passwords use PBKDF2 (600k iterations SHA-256; legacy fallback at 100k). Rate limits: 10 login attempts/15 min per IP, 300 API requests/min per IP. Mobile user-agents are auto-redirected to `/mobile.html`. New users seeded with `must_change_pw=1` are redirected to `/change-password` on login.

### API routes

| Group | Endpoints | Guard |
|-------|-----------|-------|
| Auth | `POST /login`, `GET /logout`, `GET/POST /change-password`, `POST /api/force-change-password` | none / `requireAuth` |
| Data | `GET /api/data`, `POST /api/data`, `PATCH /api/data` | `requireAuth` / `requireSup` |
| Reports | `DELETE /api/reports/:id` | `requireSup` |
| Log entries | `GET/POST/DELETE /api/log/:id`, `POST /api/log/:id/photo`, `GET /api/log/:id/photo` | `requireAuth` / `requireSup` |
| Facility | `GET/POST /api/facility/settings`, `GET/POST /api/facility/rooms`, `/api/facility/rooms/reorder`, `/api/facility/rooms/reset` | `requireAdmin` |
| Users | `GET /api/users`, `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`, `POST /api/users/:id/reset-password` | `requireAdmin` |
| Staff | `GET/POST /api/staff`, `PUT/DELETE /api/staff/:id`, `GET/POST /api/staff/categories` | `requireAuth` / `requireSup` |
| Chores | `GET/POST /api/master-chores`, `PUT /api/clients/:id/chore`, `GET/POST /api/chore-log` | `requireAuth` / `requireSup` |
| Passes | `GET/POST /api/passes`, `PUT/DELETE /api/passes/:id`, `GET/POST /api/pass-notice` | `requireAuth` / `requireSup` |
| Photos | `GET /photos/:filename` | `requireAuth` |

### Database (`db.js`)
SQLite via `sql.js` (pure JS, no native bindings). The entire DB is loaded into memory at startup and flushed to disk (`data/shift.db`) on every write via `_save()`. Public API: `query`, `query1`, `run`, `runAndSave`, `getSetting`, `setSetting`, `getAllData`, `upsertReport`.

**Schema:**

| Table | Key columns |
|-------|-------------|
| `settings` | `key TEXT PRIMARY KEY`, `value TEXT` |
| `clients` | `id`, `room`, `name`, `case_manager`, `phone`, `photo`, `admit_date`, `last_ua`, `last_room_search`, `chore_id` |
| `reports` | `id`, `date`, `shift`, `mod_name`, `statuses` (JSON), `created_at` |
| `log_entries` | `id`, `report_id`, `entry_time`, `entry_text`, `ua_photo` |
| `users` | `id`, `username`, `role`, `hash`, `salt`, `must_change_pw` |
| `staff` | `id`, `category`, `name`, `phone1`, `phone2`, `notes` |
| `passes` | `id`, `client_id`, `departure`, `return_date`, `status` |
| `chore_log` | `id`, `client_id`, `log_date`, `initials` |

**Schema migrations** go in `init()` using the try/catch `ALTER TABLE ADD COLUMN` pattern already established there. Never drop or rename columns.

**Settings** are stored as JSON strings in a `settings` key-value table. `getSetting(key, default)` handles parsing. Seed new settings keys in `_seedDefaults()`.

**`getAllData()`** returns the complete JSON payload consumed by `/api/data`. When adding new tables, extend this function and the corresponding `/api/data` GET route.

**Default credentials** (seeded on first run, all require password change on first login):
- `admin` / `Admin@123` (role: admin)
- `supervisor` / `Super@123` (role: supervisor)
- `monitor` / `Monitor@1` (role: monitor)

### Frontend pages
| Page | Route | Purpose |
|------|-------|---------|
| `index.html` | `/` | Main desktop shift report app |
| `mobile.html` | `/mobile.html` | Simplified status-update UI for phones |
| `admin.html` | `/admin` | Admin-only: user management, facility config |
| `facility.html` | `/facility` | Admin-only: room/roster management |
| `login.html` | `/login` | Auth |

### Frontend JS load order (`index.html`)
```
logos.js → storage.js → tabs.js → data.js → app.js → sync.js → sheets.js
```
Order matters. `data.js` declares globals that other modules depend on. `sync.js` loads last (after `app.js`) and overrides storage functions for server mode.

### Global state (`data.js`)
Core globals are declared with `let` or `const` at the top level — **they are NOT properties of `window`**. Use bare names (`CLIENTS`, `shiftStatuses`, `STATUS_OPTS`, `stCls`), never `window.CLIENTS` etc. The extended module globals added for v1.13 (`STAFF`, `PASSES`, `MASTER_CHORES`, `PASS_NOTICE`, `STAFF_CATEGORIES`) use `var` so they do attach to `window` and are written to by `sync.js` using `window.STAFF = ...`.

### `sync.js` — the override layer
This module is the key to dual `file://` vs server mode. It exits immediately if `location.protocol === 'file:'`. In server mode it:
1. Overrides `window.tryRestoreHandle`, `window.loadData`, `window.writeJsonData`, `window.doSave`, `window.renderArchive`, `window.selectFolder`, `window.updateFolderUI`
2. Opens a WebSocket and handles live broadcast messages (`data_saved`, `patched`, `staff_updated`, `passes_updated`, `pass_notice_updated`, `settings_updated`)
3. `applyPatch()` handles real-time status/log updates from mobile: merges `statuses` in-place and appends log entries, then re-renders only the affected UI — no full reload. `data_saved` triggers a full `serverLoad()` instead.

### `tabs.js` — extended module tabs (v1.13)
Renders Staff Directory, Chores, Weekend Passes, and Caseloads tabs. Called from `switchTab()` in `app.js`. All four render functions read directly from `CLIENTS` (the global), not from any local copy. Chore status (Active vs Weekend Pass) is derived client-side from `shiftStatuses[c.id]` — no extra API call needed.

### Role model
Three roles: `monitor` (read-only on new tabs) → `supervisor` (can write/edit most things) → `admin` (full access including user management, facility config, log deletion). Check with `isSup()` helper in `tabs.js` or `req.session.role` server-side.

### Real-time sync flow
Mobile device PATCHes `/api/data` with a status or log update → server calls `broadcast({type:'patched', patch})` → desktop `sync.js` receives it → `applyPatch()` updates in-memory state and re-renders without a full reload.

### Photo handling
Client and UA photos are stored as files under `data/photos/` by `db.savePhoto(b64, fname)`. Filenames are prefixed (`client_`, `ua_`) and validated server-side to prevent path traversal. `GET /photos/:filename` requires auth and streams from disk. Photos are referenced by relative path in the DB and sent as data URIs when needed by the frontend.

### Print layout
`@media print` in `index.html` hides everything except `#tab-passes`. The passes tab must be the active tab for printing to work correctly. Print timestamp is injected via `data-print-date` attribute before calling `window.print()`.

### TLS
If `data/cert.pem` and `data/key.pem` exist, the server automatically switches to HTTPS/WSS. Generate with `node generate_cert.js`.

## Key files

- `server.js` — all routes and WS logic (~860 lines)
- `db.js` — entire database layer (~360 lines)
- `js/data.js` — global state, `buildPayload()`, census, roster render, DOCX generation
- `js/app.js` — `switchTab()`, `buildRoster()`, `renderLog()`, status badge rendering, reminder timers
- `js/sync.js` — server-mode override layer and WebSocket client
- `js/tabs.js` — Staff, Chores, Passes, Caseloads tab logic (v1.13 addition)
- `js/sheets.js` — print sheets, modal helpers (`openModal`/`closeModal`), UA report, app init
- `js/storage.js` — File System Access API for file:// mode (overridden in server mode by sync.js)
- `data/shift.db` — the only file that needs backing up
