# OpsPoint Â· v2.3.6

Shift management platform for residential facilities. React 19 + Vite SPA frontend, Node.js + Express + SQLite backend, real-time WebSocket sync. Runs entirely on-premise â€” no cloud dependency.

---

## Features

### Core
- **Shift reports** â€” resident statuses, activity log (TIME | TYPE | DETAILS), issues, and medical notes per shift
- **Real-time sync** â€” desktop and mobile stay in sync via WebSocket broadcast
- **Mobile UI** â€” simplified status-update interface auto-served to phone browsers on the LAN
- **Census** â€” live headcount with status breakdown
- **DOCX export** â€” generate formatted shift report documents client-side
- **Archive** â€” browse and restore past shift reports
- **PWA** â€” installable on mobile devices

### HIPAA clinical modules
- **UA records** â€” result records linked to shift log entries; photo attachment per record
- **Witnessed self-administration log** â€” per-resident log of witnessed medication self-administration
- **Milestone tracker** â€” configurable milestones with completion dates and staff notes
- **Behavioral incident reports** â€” structured forms with severity, narrative, and follow-up; review workflow
- **Discharge records** â€” discharge summary with reason, destination, and follow-up fields
- **42 CFR Part 2 consent & disclosures** â€” consent form tracking; disclosure log; re-disclosure warnings
- **Audit log** â€” full actor / action / target / IP / timestamp log; viewer in Admin panel

### Extended modules
- **UA module** â€” random draw, request/acknowledge workflow, witnessed administration log, result records with photo
- **Staff directory** â€” categorized staff contacts with phone numbers and notes
- **Chore tracking** â€” assign daily chores; log completions with initials; print chore sheet
- **Weekend passes** â€” passes with departure/return dates; pass notice board; print pass sheet
- **Caseloads** â€” per-case-manager resident list; printable caseload sheet
- **Mail log** â€” track incoming mail with approval and delivery workflow

### Security
- PBKDF2-SHA512 (600,000 iterations) password hashing; legacy SHA-256/100k re-hashed on next login
- CSRF protection on all state-changing routes (Origin header validation)
- Session fixation prevention (`session.regenerate()` on login)
- Content Security Policy, `X-Powered-By` suppressed
- Rate limiting: 10 login attempts / 15 min per IP; 300 API requests / min per IP
- Magic-byte validation on photo uploads; 4 MB file size cap
- Input length limits enforced server-side
- HTTPS / WSS with self-signed certificate (auto-detected)

---

## Quick start

```bash
# 1. Install server dependencies
npm install

# 2. Install and build the React frontend
cd client && npm install && npm run build && cd ..

# 3. Generate a TLS certificate (recommended)
node generate_cert.js

# 4. Start the server
node server.js
```

Open `https://localhost:3000`. **On first run**, the server generates random credentials and prints them to the console. Copy them before closing â€” they are shown once only. All accounts require a password change on first login.

> **Windows users:** double-click `run.bat` â€” installs dependencies, builds the frontend, and starts the server in one step.

---

## Development

```bash
# Frontend hot-reload dev server on :5173 (proxies /api/* â†’ https://localhost:3000)
cd client && npm run dev

# Lint frontend
cd client && npm run lint

# Syntax-check server without running
node --check server.js
```

The backend must be running with TLS certs present (`data/cert.pem` + `data/key.pem`) before starting the dev server.

---

## Architecture

| Layer | Tech |
|-------|------|
| Server | Node.js + Express + `ws` |
| Database | SQLite via `better-sqlite3` (synchronous, in-process) |
| Frontend | React 19 + Vite SPA (`client/dist/`) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite` plugin, `@theme {}` tokens) |
| Auth | Session cookie; PBKDF2-SHA512 |
| Real-time | WebSocket broadcast on every write |

- **`server.js`** â€” all API routes, WebSocket, auth, CSRF, rate limiting
- **`db.js`** â€” schema, migrations, queries, photo storage
- **`client/src/`** â€” React SPA: `AuthContext`, `DataContext`, `AppShell`, `Dashboard`, tab components
- **`data/opspoint.db`** â€” the only file that needs backing up

See [`CLAUDE.md`](./CLAUDE.md) for the full architectural reference and [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for production setup.

---

## Roles

| Role | Access |
|------|--------|
| `pa` | Program Assistant â€” create reports, log entries, edit statuses; acknowledge UA banners; log mail; mobile access |
| `supervisor` | Everything a PA can do, plus: delete log entries, submit UA requests, manage passes, approve mail |
| `admin` | Full access including user management, facility configuration, and server administration |
| `case_manager` | Resident and pass management; UA requests; mobile access |

Actual access is controlled by the **permissions** array on each user. Roles are initial templates; permissions can be customised per user or permission profile in Admin â†’ Permission Profiles.

---

## HTTPS

```bash
node generate_cert.js
```

If `data/cert.pem` and `data/key.pem` exist, the server automatically starts in HTTPS/WSS mode. Browsers will show a self-signed cert warning â€” add a permanent exception once per device.

---

## Data

| Path | Contents |
|------|----------|
| `data/opspoint.db` | All reports, residents, users, staff, passes, logs â€” **back this up** |
| `data/photos/` | Client and UA photos |
| `data/secret.key` | Session secret (auto-generated; regenerated if deleted) |
| `data/cert.pem` / `data/key.pem` | TLS certificate / key (optional) |

---

## Windows autostart

```
Right-click install_startup.bat â†’ Run as administrator
```

Registers a Windows Scheduled Task (`OpsPointServer`) that runs the server at boot under `NetworkService`. See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for full details.

---

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md).
