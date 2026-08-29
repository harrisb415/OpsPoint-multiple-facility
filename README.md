# OpsPoint · v2.5.0

Shift management platform for residential facilities. React 19 + Vite SPA frontend, Node.js + Express + SQLite backend, real-time WebSocket sync. Runs on-premise at the facility or self-hosted on a cloud server — no SaaS dependency.

---

## Scope and limitations

**Read this before deploying.** OpsPoint implements *technical safeguards*. It is not certified,
audited, or validated by anyone, and installing it does not make an organization HIPAA compliant.

Compliance is a property of an organization, not of software. It additionally requires a documented
risk analysis, written policies and procedures, workforce training, Business Associate Agreements,
breach-notification procedures, and a contingency plan. Those remain the operator's responsibility.

**What this software does not do**

- No medication administration record, e-prescribing, drug interaction or allergy checking, labs,
  claims, or billing. A witnessed self-administration log existed through v2.4.0 and was **removed
  in v2.5.0** as out of scope — free-text drug names are a transcription-error surface.
- Not a substitute for a clinical EHR, and not intended for medical or nursing facilities that
  administer medication.
- No formal software validation, and no clinical safety certification.

**Operator responsibilities**

- Enable full-disk encryption (BitLocker, LUKS) on the host. SQLCipher protects the database file
  and its backups; it does not protect a stolen machine whose key file sits on the same volume.
- Back up `data/.dbkey` somewhere separate from the database backups. **If the key is lost, the
  database and every backup are permanently unreadable.**
- Point `backup_dir` at a different physical device, and periodically test a restore. An untested
  backup is not a backup.

---

## Features

### Core
- **Shift reports** — resident statuses, activity log (TIME | TYPE | DETAILS), issues, and medical notes per shift
- **Real-time sync** — desktop and mobile stay in sync via WebSocket broadcast
- **Mobile UI** — simplified status-update interface auto-served to phone browsers on the LAN
- **Census** — live headcount with status breakdown
- **DOCX export** — generate formatted shift report documents client-side
- **Archive** — browse and restore past shift reports
- **PWA** — installable on mobile devices

### Clinical modules
- **Clinical charting** — notes, treatment plans, assessments, group notes, and discharge summaries; draft → sign workflow with signed records locked
- **UA records** — result records linked to shift log entries; photo attachment per record
- **Milestone tracker** — configurable milestones with completion dates and staff notes
- **Behavioral incident reports** — structured forms with severity, narrative, and follow-up; review workflow
- **42 CFR Part 2 consent & disclosures** — consent form tracking; disclosure log; re-disclosure warnings
- **Record immutability** — 24-hour grace window, then locked; supervisor unlock requires a reason and is audit-logged
- **Audit log** — full actor / action / target / IP / timestamp log, on reads as well as writes; viewer in Admin panel

### Extended modules
- **UA module** — random draw, request/acknowledge workflow, result records with photo
- **Staff directory** — categorized staff contacts with phone numbers and notes
- **Chore tracking** — assign daily chores; log completions with initials; print chore sheet
- **Weekend passes** — passes with departure/return dates; pass notice board; print pass sheet
- **Caseloads** — per-case-manager resident list; printable caseload sheet
- **Mail log** — track incoming mail with approval and delivery workflow
- **Feature visibility** — switch off any module your facility does not use, including the whole Clinical section, in Admin → Features

### Security
- **Encryption at rest** — SQLCipher (`better-sqlite3-multiple-ciphers`); the database and every backup are unreadable without `data/.dbkey`
- **Scheduled backups** — dated online snapshots via `VACUUM INTO`, safe against the live database; retention and destination configurable
- **Six-year audit retention** — per 45 CFR §164.316(b)(2)(i), with a floor that cannot be configured lower
- PBKDF2-SHA512 (600,000 iterations) password hashing; legacy SHA-256/100k re-hashed on next login
- Timing-safe password comparison and a dummy hash on unknown usernames to prevent account enumeration
- CSRF protection on all state-changing routes (Origin header validation)
- Session fixation prevention (`session.regenerate()` on login); idle session timeout
- Content Security Policy, `X-Powered-By` suppressed
- Rate limiting: 10 login attempts / 15 min per IP; 300 API requests / min per IP
- Magic-byte validation on photo uploads; 4 MB file size cap
- HTTPS / WSS — self-signed cert for local deployments; Let's Encrypt via nginx for cloud

---

## Quick start

```bash
# 1. Install server dependencies
npm install

# 2. Install and build the React frontend
cd client && npm install && npm run build && cd ..

# 3. Generate a TLS certificate (local deployments only — not on a cloud box behind nginx)
node generate_cert.js

# 4. Start the server
node server.js
```

Open `https://localhost:3000`. **On first run**, the server generates random credentials and prints
them to the console. Copy them before closing — they are shown once only. All accounts require a
password change on first login.

**Also on first run**, the database is encrypted and a key is written to `data/.dbkey` (mode 0600).
An existing plaintext database is converted in place, keeping a `*.pre-encryption-*.bak` safety copy.
Back the key up before going any further.

> **Windows users:** double-click `run.bat` — installs dependencies, builds the frontend, and starts the server in one step.

To run without encryption (leaves an existing plaintext database alone):

```bash
OPSPOINT_ENCRYPT=0 node server.js
```

---

## Development

```bash
# Frontend hot-reload dev server on :5173 (proxies /api/* → https://localhost:3000)
cd client && npm run dev

# Lint frontend
cd client && npm run lint

# Syntax-check server without running
node --check server.js

# Tests
npm test
```

The backend must be running with TLS certs present (`data/cert.pem` + `data/key.pem`) before starting the dev server.

---

## Architecture

| Layer | Tech |
|-------|------|
| Server | Node.js + Express + `ws` |
| Database | SQLite via `better-sqlite3-multiple-ciphers` (synchronous, in-process, encrypted) |
| Frontend | React 19 + Vite SPA (`client/dist/`) |
| Styling | Tailwind CSS v4 + flowbite-react |
| Auth | Session cookie; PBKDF2-SHA512 |
| Real-time | WebSocket broadcast on every write |

- **`server.js`** — app wiring; routes live in `server/modules/*` (routes / service / repository per domain)
- **`server/db/connection.js`** — the only file that instantiates the database driver
- **`db.js`** — schema, queries, photo storage
- **`dbcrypt.js`** — key management and plaintext → encrypted migration
- **`backup.js`** — scheduled online backups
- **`client/src/`** — React SPA: `AuthContext`, `DataContext`, `AppShell`, `Dashboard`, tab components
- **`data/opspoint.db`** — all application data
- **`data/.dbkey`** — encryption key; back up separately, never commit

See [`CLAUDE.md`](./CLAUDE.md) for the full architectural reference, [`server/ARCHITECTURE.md`](./server/ARCHITECTURE.md)
for the module layout, and [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for production setup.

---

## Roles

| Role | Access |
|------|--------|
| `pa` | Program Assistant — create reports, log entries, edit statuses; acknowledge UA banners; log mail; mobile access |
| `supervisor` | Everything a PA can do, plus: delete log entries, submit UA requests, manage passes, approve mail |
| `admin` | Full access including user management, facility configuration, and server administration |
| `case_manager` | Resident and pass management; UA requests; mobile access |

Actual access is controlled by the **permissions** array on each user. Roles are initial templates;
permissions can be customised per user or permission profile in Admin → Permission Profiles.

---

## Deployment modes

### Local (on-premise)
Run `run.bat` (Windows) or `node server.js` directly on facility hardware. Staff access via LAN.
Generate a self-signed certificate with `node generate_cert.js` — browsers will show a cert warning;
add a permanent exception once per device.

### Cloud (self-hosted)
Deploy to a Linux VPS or cloud instance (e.g. Google Cloud). Run the server as plain HTTP on a local
port, then front it with **nginx** as a TLS terminator using a **Let's Encrypt** certificate:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.duckdns.org;
    ssl_certificate     /etc/letsencrypt/live/your-domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_set_header X-Real-IP         $remote_addr;
    }
}
```

Use `certbot --nginx -d your-domain.duckdns.org` to obtain and auto-renew the certificate. Do **not**
create a self-signed certificate on the cloud server — delete `data/cert.pem` / `data/key.pem` if
present so the server starts in HTTP mode behind nginx.

Run `bootstrap.js` (not `server.js`) so a failed update can health-check and roll back.

---

## Data

| Path | Contents |
|------|----------|
| `data/opspoint.db` | All reports, residents, users, staff, passes, logs — encrypted at rest |
| `data/.dbkey` | Encryption key — **back up separately; loss is unrecoverable** |
| `data/backups/scheduled/` | Dated online backups (encrypted with the same key) |
| `data/photos/` | Client and UA photos |
| `data/secret.key` | Session secret (auto-generated; regenerated if deleted) |
| `data/cert.pem` / `data/key.pem` | TLS certificate / key (local deployments only) |

Backups are scheduled automatically (default every 6 hours, keeping 28 generations). Configure via
the `backup_enabled`, `backup_interval_hours`, `backup_keep`, and `backup_dir` settings. The default
destination is on the same volume as the database — set `backup_dir` to another device to survive a
drive failure.

---

## Windows autostart

```
Right-click install_startup.bat → Run as administrator
```

Registers a Windows Scheduled Task (`OpsPointServer`) that runs the server at boot under
`NetworkService`. See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for full details.

---

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md).
