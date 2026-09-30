# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Product:** OpsPoint v2.7.0

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

# Permission audit: does every action a screen offers get past the server for
# everyone who can see it? (throwaway DB; exit 1 on conflicts)
node scripts/perm-audit.cjs

# Settings: every value and where it came from (secrets hidden); --check = would it start?
node server/cli/opspoint.js settings [--check] [--app central]
# Regenerate docs/SETTINGS.md after changing server/settings/schema.js (a test checks it)
node server/cli/opspoint.js settings docs > docs/SETTINGS.md
# Health check (the same checks as Admin › System health): exit 1 when one fails
node server/cli/opspoint.js doctor [--json]
# Postgres: apply missing migrations/pg files (OpsPoint also does this as it starts)
node server/cli/opspoint.js migrate [--app central] [--status]
```

**Adding a setting?** Declare it in `server/settings/schema.js`, read it with
`settings.get('NAME')` (never `process.env` — `tests/settings.test.js` fails on a direct read of
a declared setting), and regenerate `docs/SETTINGS.md`.

**Adding or changing a button that calls the API?** Add or update its entry in
`scripts/perm-audit/catalog.cjs`: when the UI shows it, and the requests it sends.
The audit (also run by `npm test`) then proves every permission set that sees the
button can actually use it.

**Build is required.** The frontend is a Vite-compiled React SPA served from `client/dist/`. Run `cd client && npm run build` after any frontend change before testing with the Express server. The dev server (`npm run dev` inside `client/`) proxies `/api/*`, `/login`, etc. to `https://localhost:3000` — the backend **must** be running with TLS (`data/cert.pem` + `data/key.pem` must exist) or the proxy will fail with SSL errors. Run `node generate_cert.js` first if certs don't exist.

**Windows scripts:** `run.bat` installs dependencies and starts the server in one step. `install_startup.bat` (run as administrator) registers a Windows Scheduled Task for boot-time autostart under `NetworkService`.

**Rehash on every commit/push.** After *every* `git commit` + `git push`, recompute the repo content digest and record the new value as the integrity baseline (in the auto-memory baseline note). Run from the repo root after pushing:

```bash
git rev-parse HEAD && git rev-parse "HEAD^{tree}" && \
git ls-files -z | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'
```

The digest is a SHA-256 over all git-tracked files (sorted), independent of commit metadata — it changes whenever tracked content changes. The recorded baseline must always match the current pushed `HEAD`. This baseline feeds the Option B update mechanism's integrity checks.

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

### Settings (`server/settings/`)

Every setting the facility app, HQ and `bootstrap.js` read from their environment is declared
once in `server/settings/schema.js` (type, default, secret, scope, per-profile default or
requirement); `docs/SETTINGS.md` is generated from it. Values come from layers, later wins:
built-in default → the profile's default → `opspoint.config.json` (app folder, or the file
`OPSPOINT_CONFIG` names; `none` ignores it) → environment variables (read live; for a secret
also `NAME_FILE`) → the provider's secret store (`OPSPOINT_SECRETS`, read once at start — see
Secrets below).

- **Profiles** (`OPSPOINT_PROFILE`): `windows-local`, `linux-local` (inferred from the platform
  when unset, with the historical defaults), `azure`, `aws`, `gcp` (managed: Postgres, trust 1
  proxy hop, `OPSPOINT_UPDATES=platform`), `docker`.
- **Startup check**: `server.js` and `central/server.js` call `settings.startupCheck()` first
  thing (only when run directly). Errors print `OpsPoint can't start: <one sentence>` and exit
  78 before any folder, key or database exists; `bootstrap.js` stops instead of relaunching.
  Warnings print and startup continues. TZ: a real IANA zone; unset only if the machine's zone
  isn't UTC; required on managed/docker.
- `settings.get(name)` throws `SettingsError` on a value that doesn't parse — never falls back.
  HQ code uses `require('../server/settings').forApp('central')`; `central/server.js` calls
  `useApp('central')` so shared modules (connection.js, pg.js) resolve in HQ's scope. In the
  file, the top level is the facility's and a `"central"` object holds HQ's own values (its PORT).
- `OPSPOINT_UPDATES=platform`: `GET /api/update/status` returns `mode:'platform'` + `message`,
  and check/apply/rollback answer 409; Admin → System shows the message instead of the buttons,
  and HQ auto-rollouts are skipped.
- Tests run with `OPSPOINT_CONFIG=none` (`tests/setup-env.js`, jest `setupFiles`), as do
  `scripts/perm-audit.cjs` and schema-parity's SQLite side, so a developer's settings file can
  never hand them a real database.

### Secrets (`server/secrets/`)

A secret is a setting marked `secret` in the schema (read with `settings.get` like any other), or
a key an on-premises install makes for itself: the session key file (`OPSPOINT_SECRET_FILE`),
`vapid.json`, `.dbkey`, `data/key.pem`, and a Google key file.

- **`NAME_FILE`**: for a secret, the environment may name a file holding it (a Docker secret).
- **The secret store** (`server/secrets/store.js`): `OPSPOINT_SECRETS=azure-key-vault` (one secret
  per setting, `session-secret`, via the managed identity), `aws-secrets-manager` (one JSON secret,
  SigV4 with the task role or keys) or `gcp-secret-manager` (one per setting, the service's
  account) — REST, no SDKs. `settings.startupCheck()` calls `loadSecrets()`, which runs
  store.js as a **child process** (`execFileSync`) so every `settings.get` stays synchronous; the
  values come back over a pipe and live only in the settings instance (never `process.env`).
  A store that refuses → exit 78; unreachable → exit 1 (the platform retries). The CLI's
  `settings`, `doctor` and `migrate` read it the same way. Only `STORE_NAMES` (schema.js) can
  come from a store: the secrets, minus the cloud credentials that reach it.
- **On a cloud profile no secret is read from disk**: a secret in the settings file, a
  `NAME_FILE` or `GOOGLE_APPLICATION_CREDENTIALS` stops startup; the generated key files are read
  and written only through `server/secrets/index.js` (`readFile`/`writeFile`/`exists`/`tlsFiles`),
  which refuses on azure/aws/gcp. `tests/secrets.test.js` fails on a direct read or write of one
  of those files anywhere else — go through `server/secrets`.
- `OPSPOINT_DB_KEY` (SQLite): the key from the environment or the store instead of `.dbkey`; no
  key file is made, and a leftover one that differs stops startup (`dbcrypt.currentKey()` is what
  the health check and the "key stored elsewhere" route read).

### Health check (`server/health/`)

One list of checks (`CHECKS` in `server/health/index.js`), run by Admin › System health
(`client/src/components/SystemHealth.jsx`), `GET /healthz`, the updater's `preflight`, a run 45 s
after every start (one `Health:` line in the log; after an update also an `update.health` audit
row), and `node server/cli/opspoint.js doctor`. Each result: `status` pass | warn | fail | skip,
`says` (what it found, in words), `fix`, `critical`. Checks: time zone (pg: `SHOW timezone`
matches), database (reachable — the only CRITICAL one — and on pg schema parity), migrations
(pg: the `schema_migrations` ledger — pending, changed-after-applied, or unrecorded), file storage
(a probe object through the storage port), secrets,
encryption key (SQLite: `.dbkey` confirmed stored elsewhere, bound to its fingerprint in the
`dbkey_backup_confirmed` setting), backups (a `backup.create` audit row < 26 h old and none failed
since — the in-app SQLite backup and `scripts/opspoint-backup.sh` both write one; or
`OPSPOINT_BACKUPS=provider`), background jobs, disk (> 20% free, local profiles), certificate
(> 14 days, when `data/cert.pem` exists), push keys (a real pair), update source (manifest
reachable + signed, in-app updates only), instance count.

- `/healthz` answers pass/fail per check and nothing else, 503 only on a critical failure (never
  for a stale backup, which a load balancer can't fix). Cached 15 s; schema parity and the update
  manifest are cached for an hour (fresh on "Run checks now" and in `doctor`).
- **Heartbeats**: background jobs call `jobs.register(name, everyMs, label)` when their timer
  starts and `jobs.beat(name)` after each run (`server/lib/jobs.js`); a new timer must do the same.
  `server/health/instances.js` writes this process's row in `app_instances` every minute (removed
  on SIGTERM/SIGINT; rows of dead processes on the same host are cleaned at start), which is how
  `doctor` in another process sees stalled jobs and a second instance.
- Schema parity lives in `server/health/schemaParity.js` + `schema-dump.js` (shipped by the
  updater); `scripts/schema-parity.cjs` is its command-line face.

### Server (`server.js`)

Express + `ws` WebSocket server. Handles auth, all API routes, and real-time broadcast. Route middleware:
- `requireAuth` — any logged-in user
- `requirePermission(perm)` — user must have the named permission
- `requireAnyPermission(...perms)` — user must have at least one listed permission
- `csrfCheck` — validates `Origin` header on all state-changing routes
- `idempotent` (`server/middleware/idempotency.js`) — a request carrying an `Idempotency-Key` runs once; a resend gets the first answer back. Used by the phone's offline queue (`client/src/mobile/outbox.js`) on `PATCH /api/data` and the `/api/rounds` writes. Put it after the permission check, on routes that answer with `res.json`.

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
| `passes` | `id`, `client_id`, `room`, `name`, `departure`, `return_date`, `ua_notes`, `notes`, `status` (`Approved`/`Out`/`Extended`/`Returned`), `created_at` |
| `chore_log` | `id`, `client_id`, `log_date`, `initials` — unique per `(client_id, log_date)` |
| `ua_requests` | `id`, `client_id`, `client_name`, `room`, `requested_by`, `requested_at`, `acknowledged`, `acknowledged_by`, `acknowledged_at` |
| `mail_log` | `id`, `client_id`, `client_name`, `room`, `logged_by`, `logged_at`, `report_id`, `notes`, `status` (`pending`/`approved`/`delivered`), `approved_by`, `approved_at`, `delivered_at` |
| `audit_log` | `id`, `ts`, `actor_id`, `actor_name`, `ip`, `action`, `target_type`, `target_id`, `target_label`, `detail` |

\* `chore` and `chore_time` added via `ALTER TABLE` migration.

**Schema migrations** — use the try/catch `ALTER TABLE ADD COLUMN` pattern in `init()`. Never drop or rename columns.

**Postgres migrations (`server/db/runner.js`)** — OpsPoint applies `migrations/pg/NNN_name.sql`
itself: at start (`OPSPOINT_MIGRATE=start`, the default; a Postgres advisory lock serializes
instances) or as a deploy step (`node server/cli/opspoint.js migrate [--app central] [--status]`
with `OPSPOINT_MIGRATE=off`, when a missing file stops the start with exit 78). Each file runs
once, in one transaction together with its ledger row in `schema_migrations` (version
`pg/NNN_name` + sha256 of the LF-normalized text); a failure rolls back whole and names the file.
A database with tables but no `pg/` rows (migrated by hand, as web-hestia was) is adopted —
every file recorded without running — only when schema parity says it matches the code.
Adding a Postgres change: the SQLite side in `server/db/migrate.js` as usual, plus a new
`migrations/pg/NNN_name.sql` (next number; `central` in the name if it is HQ's; `IF NOT EXISTS`
where possible; its own `BEGIN;`/`COMMIT;` lines are dropped, the runner wraps it). Never edit an
applied file — the health check flags a changed checksum and it never runs again; add a new
file. A new identity table goes in `IDENTITY_TABLES` in `server/db/drivers/pg.js` (a test scans
the files). `scripts/pg-audit.sh` builds its scratch schema with this runner (the fresh-install
path) before every test file.

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
| Reports | `DELETE /api/reports/:id` — body `{reason}`; only in the report's first 24 hours, never the open shift or one with UA results; audit keeps its lines | `reports.delete` |
| Log entries | `DELETE /api/log/:id` (body `{reason}`; never a UA line; audit keeps the text), `POST /api/log/:id/photo` (UA lines, once), `GET /api/log/:id/photo`, `POST /api/log/:id/void` | `log.delete` / `ua.record` / `requireAuth` / `ua.void` |
| Infractions | `POST /api/violations/:id/void` (body `{reason}`) — never deleted; status becomes `voided` | `violations.void` |
| Incident reports | `POST /api/incidents/:id/void` (body `{reason}`) — never deleted; status `voided`; audit log only (clinical, no shift-log line) | `incidents.void` |
| UA results | `POST /api/ua-records`, `PATCH /api/ua-records/:id`, `POST /api/ua-records/:id/void` — never deleted | `ua.record` / `ua.record` / `ua.void` |
| Clients | `POST /api/clients`, `PUT /api/clients/:id` | `residents.edit` |
| Facility settings | `GET /api/facility/settings`, `PUT /api/facility/settings` | `requireAuth` / `admin.settings` |
| Facility rooms | `GET /api/facility/rooms`, `GET /api/facility/rooms/vacant`, `POST /api/facility/rooms`, `PUT /api/facility/rooms/:id`, `DELETE /api/facility/rooms/:id`, `POST /api/facility/reorder`, `POST /api/facility/reset` | `facility.manage` |
| Users | `GET /api/users`, `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`, `POST /api/users/:id/reset-password` | `admin.users` |
| Permission profiles | `GET /api/permission-profiles`, `PUT /api/permission-profiles` | `admin.users` |
| Staff | `GET /api/staff`, `POST /api/staff`, `PUT /api/staff/:id`, `DELETE /api/staff/:id`, `GET /api/staff/categories`, `PUT /api/staff/categories` | `requireAuth` / `staff.edit` |
| Chores | `GET /api/master-chores`, `PUT /api/master-chores`, `PATCH /api/clients/:id/chore`, `GET /api/chore-log`, `PUT /api/chore-log` | `requireAuth` / `chores.edit` |
| Passes | `GET /api/passes`, `POST /api/passes`, `PUT /api/passes/:id`, `DELETE /api/passes/:id`, `GET /api/pass-notice`, `PUT /api/pass-notice` | `requireAuth` / `passes.edit` |
| UA requests | `GET /api/ua-requests`, `POST /api/ua-requests`, `POST /api/ua-requests/:id/acknowledge` | `requireAuth` / `ua.request` / `ua.acknowledge` |
| Mail | `GET /api/mail`, `POST /api/mail`, `PUT /api/mail/:id/approve`, `PUT /api/mail/:id/deliver`, `DELETE /api/mail/:id` (body `{reason}`) | `requireAuth` / `mail.log` / `mail.approve` / `mail.delete` |
| Admin | `POST /api/admin/restart`, `GET /api/audit-log` | `admin.settings` / `admin.users` |
| Health | `GET /healthz` (pass/fail per check only), `GET /api/system/health`, `POST /api/system/health/run`, `POST /api/system/health/dbkey-confirmed` (SQLite) | none / `admin.system` |
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
      themes.js          ← facility colour themes: the list, and the only writer of data-theme
      flowbiteTheme.js   ← app-wide flowbite overrides (modal chrome), applied in main.jsx
      ui.js              ← shared class strings: CARD_HEAD*, RAIL_* (used by all three rails)
      statuses.js        ← resident statuses: single source of truth for labels/tones
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
| `reports.delete` | Delete a report, with a reason, in its first 24 hours |
| `reminders.view` | See wellness/walkthrough reminder timers |
| `log.add` | Add log entries |
| `log.delete` | Delete log entries, with a reason (never UA lines) |
| `issues.edit` | Add/remove issues and medical notes |
| `status.edit` | Change resident statuses |
| `residents.edit` | Edit resident info |
| `staff.edit` | Manage staff directory |
| `chores.edit` | Manage chores and chore log |
| `passes.edit` | Manage weekend passes and pass notice |
| `ua.request` | Flag a resident for UA |
| `ua.acknowledge` | View and dismiss UA banner |
| `ua.record` | Record UA results (every role) |
| `ua.void` | Void a UA result with a reason — UA results are never deleted |
| `mail.log` | Log incoming mail |
| `mail.approve` | Approve mail for delivery |
| `mail.delete` | Delete mail records, with a reason |
| `violations.void` | Void an infraction with a reason — infractions are never deleted |
| `incidents.void` | Void an incident report with a reason — never deleted |
| `facility.manage` | Room and roster management |
| `admin.users` | User management and permission profiles |
| `admin.settings` | Facility settings, server restart |
| `mobile.access` | Mobile shift interface (`/mobile`) |

**Retired permissions (stripped on boot):** `mobile.full`, `ua.delete` (UA results are voided, never deleted)

**Renamed permissions (`PERM_RENAMES` in db.js, applied on boot before stripping):** `incidents.delete` → `incidents.void`, `violations.delete` → `violations.void` — whoever held the old one holds the new one.

Every delete or void takes a reason (`ReasonModal` on the client, `reasonText()` on the server), and its audit entry's detail records the reason and what was removed or voided.

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

### Client photo flow (the storage port, `server/storage/`)

1. `db.savePhoto(b64, fname)` → `server/storage/photos.js` → the storage port puts `photos/<fname>`
   in the backend `OPSPOINT_STORAGE` names — `local` (`<OPSPOINT_STORAGE_DIR>/photos/`, default the
   data folder), `azure-blob`, `s3` or `gcs` — and the DB keeps the reference `photos/<fname>`.
2. `getAllData()` → `photos.photoDataUris()` returns `data:image/…;base64,…` strings (type sniffed
   from the bytes; cloud reads cached in memory up to 64 MB, rewrites replace the cached copy).
3. React state holds the data URI directly — `src={c.photo}` with **no** path prefix.
4. `GET /photos/:filename` streams one through the port (the client doesn't use it today).

The cloud backends speak each service's REST API with Node's fetch + crypto (no SDKs): S3 with
Signature V4 (keys, ECS task role or EC2 instance role), Azure Blob with Shared Key (connection
string) or a managed-identity token, Cloud Storage with a service-account JWT or the metadata
server (none against an emulator). Keys are validated (`assertKey`: one folder word, one plain
name). `probe()` (write/read/delete a test object) is what the health check's file storage runs.

### TLS

If `data/cert.pem` and `data/key.pem` exist, the server auto-switches to HTTPS/WSS (never on a cloud profile, whose platform handles HTTPS: `server/secrets` `tlsFiles()`). Generate with `node generate_cert.js`.

---


## Theming

Six facility themes, chosen in Admin → Facility → Appearance and stored as the
`facility_theme` setting. The colours live in `client/src/index.css` as
`:root[data-theme="..."]` blocks — **generated, do not hand-edit them**. Tailwind v4
compiles its utilities to `var(--color-*)`, so switching a theme is one attribute on
`<html>`: no rebuild, no reload.

**Adding or changing a theme means editing three places:**

1. `scripts/gen-themes.cjs` — the ramp and accent, then re-run it
2. `client/src/utils/themes.js` — label, hint and swatch for the picker
3. `VALID_THEMES` in `server/modules/facility/service.js` — the allowlist

The generator asserts every theme against seven rules (contrast for buttons, brand text,
on-rail text and card headers; and a minimum 25° CIELab hue separation from the reds used
for destructive actions). It refuses nothing, but prints FAIL — check its output.

What follows a theme: brand tokens (`primary`, `accent`, `rail`), the neutral surface
tokens (`--surface-*`, and the legacy `--card-bg`/`--page-bg` set) and the `--gray-*`
ramp. What deliberately does **not**: semantic red/amber/green, and the configurable
status tones in `utils/statuses.js` — a facility on the emerald theme still shows a
positive UA in red.

Light/dark is orthogonal: a class on the same element, a different storage key
(`opspoint-theme` vs `opspoint-facility-theme`).

---

## Key files

| File | Purpose |
|------|---------|
| `server.js` | All routes, WS logic, auth, CSRF, rate limiting |
| `server/settings/schema.js` | Every setting and the six deployment profiles, declared once |
| `server/settings/index.js` | Layered values (`get`), the startup check (`startupCheck`) |
| `server/cli/opspoint.js` | Command line: `settings`, `settings --check`, `settings docs`, `doctor`, `migrate`, `keys` |
| `server/health/index.js` | The health checks (`createDoctor`: `run`, `healthz`) |
| `server/health/instances.js` | This process's heartbeat row in `app_instances` |
| `server/lib/jobs.js` | Background jobs report each run here (`register`, `beat`) |
| `server/db/runner.js` | Postgres migration runner (`startup`, `migrate`, `status`) |
| `server/storage/index.js` | The storage port (`storage()`, `put/get/remove/list/probe`) |
| `server/storage/photos.js` | Photos through the port: `savePhoto`, `photoDataUri(s)`, `readPhoto` |
| `server/storage/{local,s3,azureBlob,gcs}.js` | The four backends |
| `server/secrets/index.js` | The only reader/writer of secret files; refuses on a cloud profile |
| `server/secrets/store.js` | Key Vault, Secrets Manager, Secret Manager (run as a child by `settings.loadSecrets()`) |
| `client/src/components/SystemHealth.jsx` | Admin › System › System health card |
| `docs/SETTINGS.md` | Generated from the schema — do not edit by hand |
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
| `client/src/utils/themes.js` | Facility theme list + `applyTheme`/`setTheme`; nothing else writes `data-theme` |
| `client/src/utils/ui.js` | Shared class strings — `CARD_HEAD*`, `RAIL_*`; edit here, not at call sites |
| `scripts/gen-themes.cjs` | Generates the `:root[data-theme]` blocks in `index.css` and asserts their contrast + hue rules |
| `data/opspoint.db` | The only file that needs backing up (with its key: `data/.dbkey` or `OPSPOINT_DB_KEY`) |
