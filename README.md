# ShiftPoint · v2.0.0 · React Edition

Shift report and resident management platform for Westside Community Services residential facilities. Built with React 18 + Vite on the frontend, Node.js + Express + WebSockets + SQLite on the backend.

---

## Features

### Core
- **Shift reports** — log resident statuses, notes, med notes, and issues per shift
- **Real-time sync** — desktop and mobile stay in sync via WebSocket broadcast
- **Mobile UI** — simplified status-update interface auto-served to phone browsers on the LAN
- **Census** — live headcount with status breakdown
- **DOCX export** — generate formatted shift report documents
- **Archive** — browse and restore past shift reports
- **PWA** — installable on mobile devices

### Extended modules
- **Staff directory** — categorized staff contacts with phone numbers and notes
- **Chore tracking** — assign daily chores to residents; log completions with initials; print chore sheet
- **Weekend passes** — create and manage resident passes; mark as Out / Extended / Returned; pass notice board; print pass sheet
- **Caseloads** — per-case-manager resident list; printable caseload sheet
- **UA request system** — flag a resident for UA from mobile or desktop; banner alert for on-duty staff
- **UA tracking** — log urinalysis results with photo upload

### Facility management
- **Room / roster management** — add, edit, reorder rooms; assign residents; vacant and special rooms visible in Clients tab
- **Walk area configuration** — define walkthrough zones
- **Wellness / walk schedule** — configure check intervals
- **Facility name and theme** — custom name, green or crimson colour theme

### Security
- PBKDF2-SHA512 (600,000 iterations) password hashing
- CSRF protection on all state-changing routes (Origin header validation)
- Session fixation prevention (`session.regenerate()` on login)
- Content Security Policy, X-Powered-By suppressed, SRI on CDN scripts
- Rate limiting: 10 login attempts / 15 min per IP; 300 API requests / min per IP
- Magic-byte validation on photo uploads; 4 MB file size cap
- Input length limits enforced server-side
- HTTPS / WSS with self-signed certificate (optional)

---

## Quick start

```bash
# 1. Install server dependencies
npm install

# 2. Install and build the React frontend
cd client
npm install
npm run build
cd ..

# 3. Start the server
node server.js
```

The server starts on port 3000 and opens a browser tab automatically. The console prints the LAN IP address for mobile access.

**On first run**, the server generates random credentials and prints them to the console. Copy them before dismissing the window — they are only shown once. All accounts require a password change on first login.

> **Windows users:** double-click `run.bat` instead of running `node server.js` directly. The batch file also runs `npm install` in both the root and `client/` directories if needed.

---

## Roles

| Role | Access |
|------|--------|
| `monitor` | Read-only on most tabs; create reports, log entries, edit statuses |
| `supervisor` | Write access to reports, staff, passes, chores, UA requests |
| `admin` | Full access including user management and facility configuration |
| `case_manager` | Resident and pass management; UA requests; mobile access |

Actual access is controlled by the **permissions** array on each user, not the role alone. Roles are initial templates; permissions can be customised per user or permission profile in Admin → Permission Profiles.

---

## HTTPS (optional but recommended)

Generate a self-signed certificate:

```bash
node generate_cert.js
```

If `data/cert.pem` and `data/key.pem` exist the server automatically starts in HTTPS / WSS mode. Browsers will show a security warning for self-signed certs; add a permanent exception once.

---

## Data

| Path | Contents |
|------|----------|
| `data/shift.db` | SQLite database — the only file that needs to be backed up |
| `data/photos/` | Uploaded client and UA photos |
| `data/secret.key` | Session secret — regenerated if deleted |
| `data/cert.pem` / `data/key.pem` | TLS certificate / key (optional) |

Back up `data/shift.db` and `data/photos/` regularly. Everything else is regenerable.

---

## Windows autostart

To have ShiftPoint start automatically when the server boots:

```
Right-click install_startup.bat → Run as administrator
```

This registers a Windows Scheduled Task that runs the server at boot under the `NetworkService` account. See `docs/DEPLOYMENT.md` for full details.

---

## Architecture overview

| Layer | Tech |
|-------|------|
| Server | Node.js + Express + `ws` |
| Database | SQLite via `better-sqlite3` (in-process, writes directly to `data/shift.db`) |
| Frontend | React 18 + Vite SPA served from `client/dist/` |
| Real-time | WebSocket broadcast; mobile PATCHes server, desktop receives push |

See `CLAUDE.md` for the full architectural reference used during development.
