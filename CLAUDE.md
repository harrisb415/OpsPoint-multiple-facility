# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Product:** OpsPoint v2.0.0 — React Edition

---

## Commands

```bash
# Install server dependencies (root)
npm install

# Install and build the React frontend (run from project root)
cd client && npm install && npm run build

# Start the server
node server.js
# or
npm start

# Syntax-check server JS without running it
node --check server.js

# Dev mode (hot-reload frontend, proxy to Express on :3000)
cd client && npm run dev

# Lint the frontend
cd client && npm run lint
```

**Build is required.** The frontend is a Vite-compiled React SPA served from `client/dist/`. Run `cd client && npm run build` after any frontend change before testing with the Express server. The dev server (`npm run dev` inside `client/`) proxies `/api/*`, `/login`, etc. to `https://localhost:3000` — the backend **must** be running with TLS (`data/cert.pem` + `data/key.pem` must exist) or the proxy will fail with SSL errors. Run `node generate_cert.js` first if certs don't exist.

**Windows scripts:** `run.bat` installs dependencies and starts the server in one step. `install_startup.bat` (run as administrator) registers a Windows Scheduled Task for boot-time autostart under `NetworkService`.

---

## Architecture

### Overview

| Layer | Tech |
|-------|------|
| Server | Node.js + Express + `ws` WebSocket |
| Database | SQLite via `better-sqlite3` (in-process, direct disk writes) |
| Frontend | React 19 + Vite SPA served from `client/dist/` |
| Routing | React Router v7 (client-side); Express mirrors routes server-side for direct navigation |
| Auth state | `GET /api/me` → `AuthContext`; no `window.SESSION` injection |

### Server (`server.js`)

Express + `ws` WebSocket server. Handles auth, all API routes, and real-time broadcast. Route middleware:
- `requireAuth` — any logged-in user
- `requirePermission(perm)` — user must have the named permission
- `requireAnyPermission(...perms)` — user must have at least one listed permission
- `csrfCheck` — validates `Origin` header on all state-changing routes

Every write route calls `db.save()` then `broadcast({type: '...'})`. The WebSocket is authentication-gated at handshake level; incoming WS messages from clients are dropped.

The server serves `client/dist/index.html` for every SPA route via `serveSPA(res)`. Server-side routes that mirror React Router paths:

```
GET /          → serveSPA (AuthGuard in React handles redirect if unauth)
GET /login     → serveSPA
GET /change-password → serveSPA
GET /admin     → requireAuth + requirePermission('admin.users') → serveSPA
GET /mobile    → requireAuth + requirePermission('mobile.access') → serveSPA
GET /about     → requireAuth → serveSPA
```

**Security:** PBKDF2-SHA512 (600k iterations; legacy SHA-256/100k accepted and re-hashed on next login). CSRF: `Origin` validated on all state-changing routes. Rate limits: 10 login attempts/15 min per IP, 300 API requests/min per IP (implemented manually — no rate-limit package). `X-Powered-By` suppressed.

**First-run credentials:** Empty DB creates three accounts with cryptographically random 16-character passwords, printed once to the console. No hardcoded defaults.

### Database (`db.js`)

`better-sqlite3` — synchronous in-process SQLite. All reads/writes happen in the same Node.js process; no async, no flush step. Data is written directly to `data/opspoint.db` on every `db.run()` or `db.save()`.

Public API: `query`, `query1`, `run`, `save`, `runAndSave`, `getSetting`, `setSetting`, `setSettingAndSave`, `getAllData`, `upsertReport`, `savePhoto`, `getPhotoB64`, `getPermissionProfiles`, `setPermissionProfiles`, `auditLog`, `getAuditLog`, `pruneAuditLog`.

**Schema:**

| Table | Key columns |
|-------|-------------|
| `settings` | `key TEXT PRIMARY KEY`, `value TEXT` |
| `clients` | `id`, `room`, `name` (default `'VACANT'`), `case_manager`, `phone`, `photo`, `intake_date`, `discharge_date`, `is_special`, `is_active`, `special_label`, `sort_order`, `chore`*, `chore_time`* |
| `reports` | `id`, `report_date`, `shift`, `mod_name`, `is_closed`, `statuses`, `comments`, `last_ua`, `last_room_search`, `issues`, `med_notes` (JSON), `roster_snapshot`, `created_at`, `updated_at` |
| `log_entries` | `id`, `report_id`, `time`, `text`, `ua_photo`, `created_at` |
| `users` | `id`, `username`, `display_name`, `role`, `hash`, `salt`, `must_change_pw`, `permissions` (JSON), `created_at` |
| `staff` | `id`, `category`, `name`, `phone`, `phone2`, `notes`, `sort_order`, `created_at` |
| `passes` | `id`, `client_id`, `room`, `name`, `departure`, `return_date`, `ua_notes`, `notes`, `status` (`Out`/`Extended`/`Returned`), `created_at` |
| `chore_log` | `id`, `client_id`, `log_date`, `initials` — unique per `(client_id, log_date)` |
| `ua_requests` | `id`, `client_id`, `client_name`, `room`, `requested_by`, `requested_at`, `acknowledged`, `acknowledged_by`, `acknowledged_at` |
| `mail_log` | `id`, `client_id`, `client_name`, `room`, `logged_by`, `logged_at`, `report_id`, `notes`, `status` (`pending`/`approved`/`delivered`), `approved_by`, `approved_at`, `delivered_at` |
| `audit_log` | `id`, `ts`, `actor_id`, `actor_name`, `ip`, `action`, `target_type`, `target_id`, `target_label`, `detail` |

\* `chore` and `chore_time` added via `ALTER TABLE` migration.

**Schema migrations** — use the try/catch `ALTER TABLE ADD COLUMN` pattern in `init()`. Never drop or rename columns.

**Settings** — JSON strings in the `settings` key-value table. `getSetting(key, default)` handles parsing. Seed new keys in `_seedDefaults()`.

**`getAllData()`** — returns the full JSON payload for `GET /api/data`. Client photos are converted to base64 data URIs by `resolveClientPhoto()` before the payload is sent. When adding new tables, extend `getAllData()` and the corresponding GET route.

**Room / client model** — all rooms live in the `clients` table:
- Regular residents: `name ≠ 'VACANT'`, `is_special = 0`, `is_active = 1`
- Vacant rooms: `name = 'VACANT'`, `is_special = 0`, `is_active = 1`
- Special rooms: `is_special = 1`, may have a `special_label`
- Discharged: `is_active = 0`

### API routes

| Group | Endpoints | Permission |
|-------|-----------|------------|
| Auth | `POST /login`, `POST /logout`, `GET/POST /change-password` | none / `requireAuth` |
| Self-service | `POST /api/users/me/password`, `GET /api/me` | `requireAuth` |
| Data | `GET /api/data`, `POST /api/data`, `PATCH /api/data` | `requireAuth` |
| Reports | `DELETE /api/reports/:id` | `reports.delete` |
| Log entries | `DELETE /api/log/:id`, `POST /api/log/:id/photo`, `GET /api/log/:id/photo` | `log.delete` or `ua.delete` / `requireAuth` |
| Clients | `POST /api/clients`, `PUT /api/clients/:id` | `residents.edit` |
| Facility settings | `GET /api/facility/settings`, `PUT /api/facility/settings` | `requireAuth` / `admin.settings` |
| Facility rooms | `GET /api/facility/rooms`, `GET /api/facility/rooms/vacant`, `POST /api/facility/rooms`, `PUT /api/facility/rooms/:id`, `DELETE /api/facility/rooms/:id`, `POST /api/facility/reorder`, `POST /api/facility/reset` | `facility.manage` |
| Users | `GET /api/users`, `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`, `POST /api/users/:id/reset-password` | `admin.users` |
| Permission profiles | `GET /api/permission-profiles`, `PUT /api/permission-profiles` | `admin.users` |
| Staff | `GET /api/staff`, `POST /api/staff`, `PUT /api/staff/:id`, `DELETE /api/staff/:id`, `GET /api/staff/categories`, `PUT /api/staff/categories` | `requireAuth` / `staff.edit` |
| Chores | `GET /api/master-chores`, `PUT /api/master-chores`, `PATCH /api/clients/:id/chore`, `GET /api/chore-log`, `PUT /api/chore-log` | `requireAuth` / `chores.edit` |
| Passes | `GET /api/passes`, `POST /api/passes`, `PUT /api/passes/:id`, `DELETE /api/passes/:id`, `GET /api/pass-notice`, `PUT /api/pass-notice` | `requireAuth` / `passes.edit` |
| UA requests | `GET /api/ua-requests`, `POST /api/ua-requests`, `POST /api/ua-requests/:id/acknowledge` | `requireAuth` / `ua.request` / `ua.acknowledge` |
| Mail | `GET /api/mail`, `POST /api/mail`, `PUT /api/mail/:id/approve`, `PUT /api/mail/:id/deliver`, `DELETE /api/mail/:id` | `requireAuth` / `mail.log` / `mail.approve` / `mail.delete` |
| Admin | `POST /api/admin/restart`, `GET /api/audit-log` | `admin.settings` / `admin.users` |
| Photos | `GET /photos/:filename` | `requireAuth` |

### Frontend — React SPA (`client/`)

```
client/
  src/
    App.jsx              ← Route tree, guards, mobile redirect
    contexts/
      AuthContext.jsx    ← Session state (fetched from GET /api/me)
      DataContext.jsx    ← All app data, WebSocket, real-time sync
    components/
      AppShell.jsx       ← Desktop layout: header, icon sidebar, Outlet; DOCX export via jszip
      PrintScopeModal.jsx ← Modal for selecting print date range
      ProtectedRoute.jsx ← AuthGuard, ChangePasswordGuard
    hooks/
      usePermission.js   ← hasPerm() helper (reads from AuthContext)
    pages/
      Login.jsx
      ChangePassword.jsx
      Dashboard.jsx      ← Tab switcher + all tab panels
      Admin.jsx          ← User mgmt, permission profiles, facility config, audit log
      Mobile.jsx         ← Standalone mobile interface (own WS + data fetch)
      About.jsx          ← Version / org info page
      ReportTab.jsx      ← Active report tab (at pages/ level, not pages/tabs/)
      tabs/
        ArchiveTab.jsx
        CaseloadsTab.jsx
        ChoresTab.jsx
        ClientsTab.jsx
        MailTab.jsx
        PassesTab.jsx
        StaffTab.jsx
        UARequestsTab.jsx
        ViolationsTab.jsx
    utils/
      printLog.js        ← openPrintWindow() — opens a styled print-ready tab; shared by tabs
  index.css              ← Global styles (includes body { overflow: hidden })
```

**Routing (`App.jsx`):**
```
/login                → Login (public)
/change-password      → ChangePassword (ChangePasswordGuard)
/mobile               → MobileGuard → Mobile (requireAuth + mobile.access)
/about                → About (AuthGuard — authenticated users only)
/                     → AuthGuard → AppShell → Dashboard
/admin                → AuthGuard → AppShell → Admin
```

`MobileAutoRedirect` — detects mobile UA, checks `mobile.access`, redirects to `/mobile` unless `?desktop=1` is in the URL or the path is already excluded.

**Auth flow:** `AuthContext` calls `GET /api/me` on mount. Returns `{ id, username, displayName, role, permissions, mustChangePw }`. Guards redirect based on this state. No `window.SESSION` injection.

**Data flow (`DataContext`):**
1. `loadData()` calls `GET /api/data` — full snapshot
2. Opens WebSocket; handles: `data_saved` (full reload), `patched` (optimistic merge), `staff_updated`, `passes_updated`, `pass_notice_updated`, `chore_log_updated`, `mail_updated`, `ua_request`, `permissions_updated`, `settings_updated`, `server_restarting`
3. `saveData(patch)` — calls `POST /api/data`, optimistically updates local state
4. `saveStatus` — `'idle' | 'saving' | 'saved' | 'err'` — shown in header

**Permission check:** `usePermission().hasPerm('perm.key')` in components, `requirePermission('perm.key')` middleware server-side.

**DOCX export:** `AppShell.jsx` uses `jszip` to generate shift report documents client-side.

**Scroll architecture:** `body { overflow: hidden }` in `index.css` means body scroll is disabled globally. Content must scroll within a flex chain:
- Container: `display: flex; flex-direction: column; height: 100%; overflow: hidden`
- Scrollable child: `flex: 1; overflow-y: auto; min-height: 0`
- Fixed bars: `flex-shrink: 0` (not `position: fixed`)

### Permission system

Permissions stored as a JSON array on each `users` row. `PERMISSIONS` is the master list; `ROLE_PRESETS` defines defaults per role. Used during account creation and permission profile seeding.

Boot-time migrations:
- `_migratePermissions` — strips retired permissions from all users (runs every boot)
- `_migrateGroups` — strips retired perms from stored permission groups
- `_migrateProfiles` — strips retired perms from stored permission profiles

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
| `mail.delete` | Delete mail records |
| `facility.manage` | Room and roster management |
| `admin.users` | User management and permission profiles |
| `admin.settings` | Facility settings, server restart |
| `mobile.access` | Mobile shift interface (`/mobile`) |

**Retired permissions (stripped on boot):** `mobile.full`

### Mobile page (`Mobile.jsx`)

Standalone React component — does **not** use `AppShell` or `DataContext`. Has its own:
- `fetch('/api/data')` on mount
- WebSocket connection with reconnect (handles `data_saved`, `patched`, `settings_updated`)
- Inlined CSS (no bleed to desktop styles)

Tabs: Wellness (client status checks + UA requests), Walk (area walkthrough toggles), Log (entries list + add), Census (status counts).

Optimistic PATCH writes to `/api/data`. Deduplicates own log entries when WS echoes back. Header includes facility name, user, live-dot, Desktop link (`/?desktop=1`), reload, sign out.

### `Mobile.jsx` scroll pattern

```css
.mob            { display: flex; flex-direction: column; height: 100%; overflow: hidden }
.mob-panel      { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0 }
.mob-scroll     { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch }
.mob-submit-bar { flex-shrink: 0 }   /* NOT position: fixed */
```

### Client photo flow

1. `db.savePhoto(b64, fname)` writes to `data/photos/`; stores filename in DB
2. `getAllData()` → `resolveClientPhoto(c)` reads the file and returns a `data:image/…;base64,…` string
3. React state holds the data URI directly — `src={c.photo}` with **no** path prefix

### TLS

If `data/cert.pem` and `data/key.pem` exist, the server auto-switches to HTTPS/WSS. Generate with `node generate_cert.js`.

---

## Planned features

`docs/FEATURE-NOTIFICATIONS.md` contains a full implementation spec for a notification bell, UA random draw, and broadcast messages system. **Note:** this spec was ported from OpsPoint (a vanilla-JS predecessor) and references DOM/JS patterns (`js/app.js`, `js/sync.js`, `index.html` banner elements) that do not exist in this React codebase. Any implementation must be adapted to the React component and context architecture described above.

---

## Key files

| File | Purpose |
|------|---------|
| `server.js` | All routes, WS logic, auth, CSRF, rate limiting |
| `db.js` | Database layer — schema, migrations, queries, photo storage |
| `client/src/App.jsx` | Route tree, auth guards, mobile redirect |
| `client/src/contexts/AuthContext.jsx` | Session state |
| `client/src/contexts/DataContext.jsx` | All app data, WS, real-time sync |
| `client/src/components/AppShell.jsx` | Desktop layout + header (DOCX generation, filing prints, email) |
| `client/src/pages/Dashboard.jsx` | Tab switcher + all tab panels |
| `client/src/pages/Admin.jsx` | User mgmt, permission profiles, facility config, audit log |
| `client/src/pages/Mobile.jsx` | Standalone mobile interface |
| `client/src/pages/About.jsx` | Version / org info (authenticated users only) |
| `client/src/pages/ReportTab.jsx` | Active shift report tab (lives at pages/ level, not pages/tabs/) |
| `client/src/pages/tabs/*.jsx` | Individual tab components |
| `client/src/utils/printLog.js` | `openPrintWindow()` — shared print helper used by multiple tabs |
| `data/opspoint.db` | The only file that needs backing up |
