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
Express + `ws` WebSocket server. Handles auth, all API routes, and real-time broadcast (~1300 lines). Route middleware:
- `requireAuth` — any logged-in user
- `requirePermission(perm)` — user must have the named permission in `SESSION.permissions`
- `requireAnyPermission(...perms)` — user must have at least one of the listed permissions
- `csrfCheck` — validates `Origin` header against server host on all state-changing routes

Every write route calls `db.save()` then `broadcast({type: '...'})`. The WebSocket is authentication-gated at the handshake level. Clients can only receive — incoming WS messages are dropped.

`window.SESSION` is injected into served HTML pages by `injectSession()` before the `</head>` tag. This is how the frontend knows the current user's role and permissions array.

**Security details:** Passwords use PBKDF2 (600k iterations SHA-512; legacy SHA-256/100k hashes accepted and re-hashed on next login). CSRF: `Origin` header validated on all state-changing routes. Rate limits: 10 login attempts/15 min per IP, 300 API requests/min per IP. Mobile user-agents are auto-redirected to `/mobile.html`. New users seeded with `must_change_pw=1` are redirected to `/change-password` on login.

**First-run credentials:** On an empty database, three accounts are created with cryptographically random 16-character passwords printed once to the console. There are no hardcoded default passwords.

### API routes

| Group | Endpoints | Permission |
|-------|-----------|------------|
| Auth | `POST /login`, `POST /logout`, `GET/POST /change-password` | none / `requireAuth` |
| Self-service | `POST /api/users/me/password`, `GET /api/me` | `requireAuth` |
| Data | `GET /api/data`, `POST /api/data`, `PATCH /api/data` | `requireAuth` |
| Reports | `DELETE /api/reports/:id` | `reports.delete` |
| Log entries | `DELETE /api/log/:id`, `POST /api/log/:id/photo`, `GET /api/log/:id/photo` | `log.delete` or `ua.delete` / `requireAuth` |
| Clients | `PUT /api/clients/:id` | `residents.edit` |
| Facility settings | `GET /api/facility/settings`, `PUT /api/facility/settings` | `requireAuth` / `admin.settings` |
| Facility rooms | `GET /api/facility/rooms`, `GET /api/facility/rooms/vacant`, `POST /api/facility/rooms`, `PUT /api/facility/rooms/:id`, `DELETE /api/facility/rooms/:id`, `POST /api/facility/reorder`, `POST /api/facility/reset` | `facility.manage` |
| Users | `GET /api/users`, `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`, `POST /api/users/:id/reset-password` | `admin.users` |
| Permission profiles | `GET /api/permission-profiles`, `PUT /api/permission-profiles` | `admin.users` |
| Staff | `GET /api/staff`, `POST /api/staff`, `PUT /api/staff/:id`, `DELETE /api/staff/:id`, `GET /api/staff/categories`, `PUT /api/staff/categories` | `requireAuth` / `staff.edit` |
| Chores | `GET /api/master-chores`, `PUT /api/master-chores`, `PATCH /api/clients/:id/chore`, `GET /api/chore-log`, `PUT /api/chore-log` | `requireAuth` / `chores.edit` |
| Passes | `GET /api/passes`, `POST /api/passes`, `PUT /api/passes/:id`, `DELETE /api/passes/:id`, `GET /api/pass-notice`, `PUT /api/pass-notice` | `requireAuth` / `passes.edit` |
| UA requests | `GET /api/ua-requests`, `POST /api/ua-requests`, `POST /api/ua-requests/:id/acknowledge` | `requireAuth` / `ua.request` / `ua.acknowledge` |
| Mail | `GET /api/mail`, `POST /api/mail`, `PUT /api/mail/:id/approve`, `PUT /api/mail/:id/deliver`, `DELETE /api/mail/:id` | `requireAuth` / `mail.log` / `mail.approve` / `log.delete` |
| Admin | `POST /api/admin/restart`, `GET /api/audit-log` | `admin.settings` / `admin.users` |
| Photos | `GET /photos/:filename` | `requireAuth` |

### Database (`db.js`)
SQLite via `sql.js` (pure JS, no native bindings). The entire DB is loaded into memory at startup and flushed to disk (`data/shift.db`) on every write via `_save()` (~625 lines).

Public API: `query`, `query1`, `run`, `save`, `runAndSave`, `getSetting`, `setSetting`, `setSettingAndSave`, `getAllData`, `upsertReport`, `savePhoto`, `getPhotoB64`, `getPermissionProfiles`, `setPermissionProfiles`, `auditLog`, `getAuditLog`, `pruneAuditLog`.

**Schema:**

| Table | Key columns |
|-------|-------------|
| `settings` | `key TEXT PRIMARY KEY`, `value TEXT` |
| `clients` | `id`, `room`, `name`, `case_manager`, `phone`, `photo`, `intake_date`, `discharge_date`, `is_special`, `is_active`, `special_label`, `sort_order`, `chore`*, `chore_time`* |
| `reports` | `id`, `report_date`, `shift`, `mod_name`, `is_closed`, `statuses`, `comments`, `last_ua`, `last_room_search`, `issues`, `med_notes` (all JSON), `roster_snapshot`, `created_at`, `updated_at` |
| `log_entries` | `id`, `report_id`, `time`, `text`, `ua_photo`, `created_at` |
| `users` | `id`, `username`, `display_name`, `role`, `hash`, `salt`, `must_change_pw`, `permissions` (JSON array), `created_at` |
| `staff` | `id`, `category`, `name`, `phone`, `phone2`, `notes`, `sort_order`, `created_at` |
| `passes` | `id`, `client_id`, `room`, `name`, `departure`, `return_date`, `ua_notes`, `notes`, `status` (`Out`/`Extended`/`Returned`), `created_at` |
| `chore_log` | `id`, `client_id`, `log_date`, `initials` — unique per `(client_id, log_date)` |
| `ua_requests` | `id`, `client_id`, `client_name`, `room`, `requested_by`, `requested_at`, `acknowledged`, `acknowledged_by`, `acknowledged_at` |
| `mail_log` | `id`, `client_id`, `client_name`, `room`, `logged_by`, `logged_at`, `report_id`, `notes`, `status` (`pending`/`approved`/`delivered`), `approved_by`, `approved_at`, `delivered_at` |
| `audit_log` | `id`, `ts`, `actor_id`, `actor_name`, `ip`, `action`, `target_type`, `target_id`, `target_label`, `detail` |

\* `chore` and `chore_time` are added via `ALTER TABLE` migration, not in the original `CREATE TABLE`.

**Schema migrations** go in `init()` using the try/catch `ALTER TABLE ADD COLUMN` pattern already established there. Never drop or rename columns.

**Settings** are stored as JSON strings in a `settings` key-value table. `getSetting(key, default)` handles parsing. Seed new settings keys in `_seedDefaults()`.

**`getAllData()`** returns the complete JSON payload consumed by `/api/data`. When adding new tables, extend this function and the corresponding `/api/data` GET route.

### Permission system
Permissions are stored as a JSON array on each `users` row. `ROLE_PRESETS` in `db.js` defines the default permission set for each role — used when seeding new accounts and the `permission_profiles` setting. `PERMISSIONS` is the master list of all valid permission keys.

| Permission | What it grants |
|------------|---------------|
| `reports.create` | Create and save shift reports |
| `reports.close` | Close/lock a shift |
| `reports.delete` | Delete a report |
| `reminders.view` | See wellness/walkthrough reminder timers |
| `log.add` | Add log entries |
| `log.delete` | Delete log entries |
| `issues.edit` | Add/remove issues and medical notes |
| `status.edit` | Change resident statuses |
| `residents.edit` | Edit resident info |
| `staff.edit` | Manage staff directory |
| `chores.edit` | Manage chores and chore log |
| `passes.edit` | Manage weekend passes and pass notice |
| `ua.request` | Flag a resident for UA |
| `ua.acknowledge` | View and dismiss UA banner |
| `ua.delete` | Delete UA log entries |
| `mail.log` | Log incoming mail |
| `mail.approve` | Approve mail for delivery |
| `facility.manage` | Room and roster management |
| `admin.users` | User management and permission profiles |
| `admin.settings` | Facility settings, server restart |
| `mobile.access` | Basic mobile interface (`mobile.html`) |
| `mobile.full` | Full mobile interface (`mobile-full.html`) |

Server-side check: `requirePermission('perm.key')` middleware. Frontend check: `SESSION.permissions.includes('perm.key')` (or the `hasPerm()` helper in `tabs.js`).

### Frontend pages
| Page | Route | Purpose |
|------|-------|---------|
| `index.html` | `/` | Main desktop shift report app |
| `mobile.html` | `/mobile.html` | Simplified status-update UI for phones |
| `mobile-full.html` | `/mobile-full.html` | Full-featured mobile variant |
| `admin.html` | `/admin` | User management, permission profiles, facility config, audit log |
| `login.html` | `/login` | Auth |
| `about.html` | `/about` | Version/info page |

Note: `/facility` redirects 302 to `/admin`.

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
2. Opens a WebSocket and handles live broadcast messages: `data_saved`, `patched`, `staff_updated`, `passes_updated`, `pass_notice_updated`, `chore_log_updated`, `mail_updated`, `ua_request`, `permissions_updated`, `settings_updated`, `server_restarting`
3. `applyPatch()` handles real-time status/log updates from mobile: merges `statuses` in-place and appends log entries, then re-renders only the affected UI — no full reload. `data_saved` triggers a full `serverLoad()` instead.

### `tabs.js` — extended module tabs (v1.13)
Renders Staff Directory, Chores, Weekend Passes, and Caseloads tabs. Called from `switchTab()` in `app.js`. All four render functions read directly from `CLIENTS` (the global), not from any local copy. Chore status (Active vs Weekend Pass) is derived client-side from `shiftStatuses[c.id]` — no extra API call needed.

### Role model
Four roles: `monitor`, `supervisor`, `admin`, `case_manager`. Roles are templates — actual access is determined by the `permissions` array on each user. Check with `hasPerm(perm)` helper in `tabs.js` (reads `SESSION.permissions`) or `requirePermission(perm)` middleware server-side.

### Real-time sync flow
Mobile device PATCHes `/api/data` with a status or log update → server calls `broadcast({type:'patched', patch})` → desktop `sync.js` receives it → `applyPatch()` updates in-memory state and re-renders without a full reload.

### Photo handling
Client and UA photos are stored as files under `data/photos/` by `db.savePhoto(b64, fname)`. Filenames are prefixed (`client_`, `ua_`) and validated server-side to prevent path traversal. `GET /photos/:filename` requires auth and streams from disk. Photos are referenced by relative path in the DB and sent as data URIs when needed by the frontend.

### Print layout
`@media print` in `index.html` hides everything except `#tab-passes`. The passes tab must be the active tab for printing to work correctly. Print timestamp is injected via `data-print-date` attribute before calling `window.print()`.

### TLS
If `data/cert.pem` and `data/key.pem` exist, the server automatically switches to HTTPS/WSS. Generate with `node generate_cert.js`.

## Key files

- `server.js` — all routes and WS logic (~1300 lines)
- `db.js` — entire database layer (~625 lines)
- `js/data.js` — global state, `buildPayload()`, census, roster render, DOCX generation
- `js/app.js` — `switchTab()`, `buildRoster()`, `renderLog()`, status badge rendering, reminder timers
- `js/sync.js` — server-mode override layer and WebSocket client
- `js/tabs.js` — Staff, Chores, Passes, Caseloads tab logic (v1.13 addition)
- `js/sheets.js` — print sheets, modal helpers (`openModal`/`closeModal`), UA report, app init
- `js/storage.js` — File System Access API for file:// mode (overridden in server mode by sync.js)
- `sw.js` — service worker for PWA/offline support on mobile
- `data/shift.db` — the only file that needs backing up
