# ShiftPoint &nbsp;Â·&nbsp; v1.14.0

Shift report and resident management app for residential facilities. Built with Node.js, Express, WebSockets, and SQLite â€” no build step, no framework, plain HTML/CSS/JS on the frontend.

---

## Features

### Core
- **Shift reports** â€” log resident statuses, notes, med notes, and issues per shift
- **Real-time sync** â€” desktop and mobile stay in sync via WebSocket broadcast
- **Mobile UI** â€” simplified status-update interface auto-served to phone browsers on the LAN
- **Census** â€” live headcount with status breakdown
- **DOCX export** â€” generate formatted shift report documents
- **Archive** â€” browse and restore past shift reports
- **PWA** â€” installable on mobile devices

### Extended modules
- **Staff directory** â€” categorized staff contacts with phone numbers and notes
- **Chore tracking** â€” assign daily chores to residents; log completions with initials; print chore sheet
- **Weekend passes** â€” create and manage resident passes; mark as Out / Extended / Returned; pass notice board; print pass sheet
- **Caseloads** â€” per-case-manager resident list; printable caseload sheet
- **UA request system** â€” flag a resident for UA from mobile or desktop; banner alert for on-duty staff
- **UA tracking** â€” log urinalysis results with photo upload

### Facility management
- **Room / roster management** â€” add, edit, reorder rooms; assign residents
- **Walk area configuration** â€” define walkthrough zones
- **Wellness / walk schedule** â€” configure check intervals
- **Facility name and theme** â€” custom name, green or default colour theme

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
npm install
node server.js
```

The server starts on port 3000 and opens a browser tab automatically. The console prints the LAN IP address for mobile access.

**On first run**, the server generates random credentials and prints them to the console. Copy them before dismissing the window â€” they are only shown once. All accounts require a password change on first login.

> **Windows users:** double-click `run.bat` instead of running `node server.js` directly.

---

## Roles

| Role | Access |
|------|--------|
| `monitor` | Read-only on most tabs |
| `supervisor` | Write access to reports, staff, passes, chores, UA requests |
| `admin` | Full access including user management and facility configuration |

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
| `data/shift.db` | SQLite database â€” the only file that needs to be backed up |
| `data/photos/` | Uploaded client and UA photos |
| `data/secret.key` | Session secret â€” regenerated if deleted |
| `data/cert.pem` / `data/key.pem` | TLS certificate / key (optional) |

Back up `data/shift.db` and `data/photos/` regularly. Everything else is regenerable.

---

## Windows autostart

To have ShiftPoint start automatically when the server boots:

```
Right-click install_startup.bat â†’ Run as administrator
```

This registers a Windows Scheduled Task that runs the server at boot under the `NetworkService` account. See `docs/DEPLOYMENT.md` for full details.

---

## Architecture overview

| Layer | Tech |
|-------|------|
| Server | Node.js + Express + `ws` |
| Database | SQLite via `sql.js` (pure JS, in-memory, flushed to disk on every write) |
| Frontend | Plain HTML / CSS / JS â€” no transpilation, no bundler |
| Real-time | WebSocket broadcast; mobile PATCHes server, desktop receives push |

See `CLAUDE.md` for the full architectural reference used during development.
