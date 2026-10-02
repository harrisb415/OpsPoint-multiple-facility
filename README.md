# OpsPoint · v2.7.0

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
- **Weekend passes** — Approved / Active / Returned lifecycle with Mark Departed (unlocks ten minutes
  before the scheduled departure) and Mark Returned; Extend records who moved the return and from what,
  on the pass; pass notice board; print pass sheet
- **Caseloads** — per-case-manager resident list; printable caseload sheet
- **Mail log** — track incoming mail with approval and delivery workflow
- **Feature visibility** — switch off any module your facility does not use, including the whole Clinical section, in Admin → Features
- **Resident statuses** — rename, recolour, add or retire the statuses staff can select, in Admin → Statuses;
  four are permanent and a status in use on an open shift cannot be removed
- **Facility theme** — pick the brand colour in Admin → Appearance (Indigo, Blue, Teal, Emerald, Rose,
  Beacon). Applies to every signed-in session without a reload, across the whole interface rather
  than the sidebar alone. Light and dark mode remain a separate per-user choice.
  Status colours and the red/amber/green used to signal state are deliberately unaffected.

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

## Installers

From the first release that carries them, each target has a one-step install that ends with the
setup link and its one-time code:

| Target | How |
|--------|-----|
| Windows | `OpsPoint-Setup-<version>.exe` (Node included), or unattended `/VERYSILENT /CONFIG=answers.env /LOG=setup.log` (exit code 10: installed but not running, the log says why); maintenance from Start › OpsPoint Setup (asks for administrator rights); the service logs to `<data folder>\logs\opspoint.log` |
| Linux | `sudo bash install.sh` (menus), or `sudo bash install.sh --config answers.env --yes`; afterwards `sudo opspoint` |
| Docker | `packaging/docker/docker-compose.yml`: OpsPoint and Postgres, `.env` with `TZ` and `POSTGRES_PASSWORD` |

The installers live in `packaging/`; `bash packaging/linux/install.sh --dry-run --yes` shows what an
install would do without changing anything. From a checkout, the Quick start below still works.
What is tested and supported, and the minimum versions: [`docs/SUPPORT.md`](./docs/SUPPORT.md).

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

Open `https://localhost:3000`. **On first run** there are no accounts: the server prints a one-time
setup code (valid 24 hours) and the address of the setup page. Open it, enter the code and create the
first administrator; the setup wizard then covers the facility, shifts, rooms, care defaults,
features, staff (each gets an invite link or QR code to set their own password), security and the
phone app. Lost the code? `node server/cli/opspoint.js setup-code` makes a new one.

**Also on first run**, the database is encrypted and a key is written to `data/.dbkey` (mode 0600).
An existing plaintext database is converted in place, keeping a `*.pre-encryption-*.bak` safety copy.
Back the key up before going any further.

> **Windows users:** double-click `run.bat` — installs dependencies, builds the frontend, and starts the server in one step.

To run without encryption (leaves an existing plaintext database alone):

```bash
OPSPOINT_ENCRYPT=0 node server.js
```

### Settings

With no settings at all, OpsPoint runs as before: SQLite in `data/`, port 3000. Anything else is
set with environment variables or an `opspoint.config.json` file in the app folder (never
committed; the environment wins over the file). `OPSPOINT_PROFILE` picks the defaults for a kind of
deployment: `windows-local`, `linux-local`, `azure`, `aws`, `gcp` or `docker`. Every setting, its
default and the profiles that require it are listed in [`docs/SETTINGS.md`](./docs/SETTINGS.md).

Photos are kept in `data/photos/` unless `OPSPOINT_STORAGE` says otherwise: `azure-blob`, `s3`
(or an S3-compatible service) or `gcs` store them in the provider's storage instead, which the
managed cloud profiles require.

On Postgres (`OPSPOINT_DB_DRIVER=pg`), OpsPoint applies its own schema changes from
`migrations/pg/` as it starts. To run them as a separate deploy step instead, set
`OPSPOINT_MIGRATE=off` and run `node server/cli/opspoint.js migrate` (and `--app central` for HQ)
before starting.

Secrets (the session key, push keys, database connection strings, the SQLite key) can also come
from a file the environment names as `NAME_FILE` (a Docker secret), or from the provider's secret
store read once at start: `OPSPOINT_SECRETS=azure-key-vault`, `aws-secrets-manager` or
`gcp-secret-manager` (see "Secrets" in [`docs/SETTINGS.md`](./docs/SETTINGS.md)). On the `azure`,
`aws` and `gcp` profiles no secret is read from disk. `OPSPOINT_DB_KEY` keeps the SQLite key out
of the data folder, so a copy of that folder alone is unreadable.

A missing or contradictory setting stops the server with one sentence saying what to fix. The
facility's time zone is required: set `TZ` (for example `TZ=America/Chicago`) unless the machine's
own clock is already in it; a server on UTC files evening entries under the next day.

```bash
node server/cli/opspoint.js settings           # every value and where it came from (secrets hidden)
node server/cli/opspoint.js settings --check   # would OpsPoint start? exit 78 and the reasons if not
node server/cli/opspoint.js doctor             # the health check: exit 1 when a check fails
```

### Health check

Admin › System › **System health** shows whether the install is healthy: time zone, database,
migrations, file storage, secrets, the encryption key (confirm it is stored somewhere else),
backups, background jobs, disk space, certificate, push keys, the update source and the number
of running servers, each with what it found and how to fix it. `GET /healthz` gives the same
checks as pass/fail only, for a load balancer or monitoring (503 only when the database is
unreachable).

### Export, import and the restore drill

An export is one encrypted file with every record and photo of an install. Any new install —
Windows or Linux, SQLite or Postgres, on premises or in a cloud — can import it, so it is how a
facility moves, and nightly exports are an off-site copy that does not depend on the database kind.

```bash
node server/cli/opspoint.js export --out D:\Exports     # passphrase: OPSPOINT_EXPORT_PASSPHRASE, a file, or typed
node server/cli/opspoint.js import <file>               # into a new, empty install (OpsPoint stopped)
node server/cli/opspoint.js drill D:\Exports            # restore the newest into a scratch install + health check
```

Import refuses an export from a newer version and an install that already has records, loads
everything in one transaction and counts every table afterwards. Everyone keeps their password;
phone PINs and push alerts are set up again on each phone. The link to HQ travels only with
`--include-hq` / `--keep-hq`. See "Exports" in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

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
- **`server/db/dbcrypt.js`** — key management and plaintext → encrypted migration
- **`server/lib/backup.js`** — scheduled online backups
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
| `data/.dbkey` | Encryption key — **back up separately; loss is unrecoverable** (not made when `OPSPOINT_DB_KEY` is set) |
| `data/backups/scheduled/` | Dated online backups (encrypted with the same key) |
| `data/photos/` | Client and UA photos |
| `data/secret.key` | Session secret (auto-generated unless `SESSION_SECRET` is set; regenerated if deleted) |
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
