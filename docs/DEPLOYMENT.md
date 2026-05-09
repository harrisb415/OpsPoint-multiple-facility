# ShiftPoint — Deployment Guide

This guide covers installing ShiftPoint on a Windows machine that will act as the permanent server for your facility. Staff access the app from any browser on the same Wi-Fi network.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [First run and credential setup](#3-first-run-and-credential-setup)
4. [Network access (mobile and desktop)](#4-network-access-mobile-and-desktop)
5. [HTTPS / WSS (recommended)](#5-https--wss-recommended)
6. [Windows autostart](#6-windows-autostart)
7. [User management](#7-user-management)
8. [Backup strategy](#8-backup-strategy)
9. [Updating ShiftPoint](#9-updating-shiftpoint)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| Windows 10 or 11 | Server machine — can be any PC that stays on |
| Node.js LTS | Download from https://nodejs.org — click "LTS", run installer with all defaults |
| Chrome or Edge | Recommended browser for the desktop app |
| LAN Wi-Fi | All devices must be on the same network |

Verify Node.js installed correctly by opening a Command Prompt and running:

```
node --version
npm --version
```

Both should print version numbers. If not, reinstall Node.js.

---

## 2. Installation

1. Copy the ShiftPoint folder to a permanent location on the server machine, e.g.:
   ```
   C:\ShiftPoint\
   ```

2. Open a Command Prompt in that folder and install dependencies:
   ```
   npm install
   ```
   This only needs to be done once. A `node_modules` folder will be created.

3. Create the data directories (the server does this automatically on first run, but you can create them manually):
   ```
   mkdir data
   mkdir data\photos
   ```

---

## 3. First run and credential setup

Start the server:

```
node server.js
```

Or double-click **`run.bat`** — it checks for Node.js, runs `npm install` if needed, and starts the server.

**On the very first run**, ShiftPoint detects an empty database and creates three accounts with randomly-generated passwords. These are printed to the console in a box like this:

```
╔══════════════════════════════════════════╗
║        ShiftPoint — First Run            ║
║  Default credentials (save these now):   ║
║                                          ║
║  admin      :  xK9#mPqL2rVw!nZs         ║
║  supervisor :  Bj7@cYtN5hXe^kRm         ║
║  monitor    :  Wq3&dFuA8sGp$oHj         ║
║                                          ║
║  All accounts require a password change  ║
║  on first login.                         ║
╚══════════════════════════════════════════╝
```

**Copy these passwords before closing the window.** They are only displayed once.

Open Chrome and go to `http://localhost:3000`. Log in with the `admin` account and set your permanent password when prompted.

> If you lose all admin credentials, stop the server, delete `data/shift.db`, and restart. This resets the database — all data will be lost.

---

## 4. Network access (mobile and desktop)

The server prints the LAN IP address on startup, e.g.:

```
  Desktop : http://localhost:3000
  Mobile  : http://192.168.1.42:3000
```

- **Desktop staff** — open `http://localhost:3000` in Chrome on the server machine, or use the LAN IP from any computer on the same network.
- **Mobile staff** — open `http://192.168.1.42:3000` in the phone browser (Chrome recommended). The server detects mobile user-agents and serves the simplified mobile UI automatically. Add to the home screen for a PWA-like experience.
- **Admin panel** — `http://localhost:3000/admin` (admin role required)
- **Facility setup** — `http://localhost:3000/facility` (admin role required)

> The server machine's IP address can change if your router reassigns it. For permanent deployments, assign a static LAN IP to the server in your router's DHCP settings, or use the machine's hostname (e.g., `http://DESKTOP-ABC123:3000`).

---

## 5. HTTPS / WSS (recommended)

Running over HTTPS prevents credentials and session tokens from being sent in plaintext on the LAN. It is strongly recommended for any production deployment.

**Step 1 — Generate a self-signed certificate:**

```
node generate_cert.js
```

This creates `data/cert.pem` and `data/key.pem`. The certificate is valid for 10 years.

**Step 2 — Restart the server.**

The server detects the certificate files automatically and starts in HTTPS mode. The console will confirm:

```
Listening on https://0.0.0.0:3000
```

**Step 3 — Accept the browser warning.**

Because the certificate is self-signed (not issued by a public CA), browsers will show a "Your connection is not private" warning the first time.

- In Chrome: click **Advanced** → **Proceed to [IP] (unsafe)**
- Check "Always trust" or add a permanent exception if the option appears

Staff only need to do this once per device.

**Mobile note:** On Android Chrome, tap **Advanced** → **Proceed**. On iOS Safari, tap **Show Details** → **visit this website** → **Visit Website** → **Continue**.

After accepting, all traffic (including WebSocket) is encrypted.

---

## 6. Windows autostart

For the server to run automatically whenever the PC boots (without anyone logging in), use the included startup installer.

**Step 1:**

Right-click `install_startup.bat` and select **Run as administrator**.

The script will:
- Detect your Node.js installation path
- Create a `run_silent.bat` launcher
- Grant the `NetworkService` account access to the ShiftPoint folder
- Register a Windows Scheduled Task named `ShiftPointServer` that runs at boot

**Step 2:** The script starts the task immediately. Open `http://localhost:3000` to confirm it's running.

### Managing the scheduled task

| Action | Command |
|--------|---------|
| Start now | `schtasks /run /tn "ShiftPointServer"` |
| Stop | `schtasks /end /tn "ShiftPointServer"` |
| Remove autostart | `schtasks /delete /tn "ShiftPointServer" /f` |
| Check status | Task Scheduler → Task Scheduler Library → ShiftPointServer |

You can also use **`start_server.bat`** (double-click) to start the server on demand.

### Fallback: startup folder

If the scheduled task cannot be registered (e.g., Group Policy restriction), place a shortcut to `run.bat` in your Windows Startup folder:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
```

The server will start when you log into Windows instead of at boot.

### Firewall

Windows Firewall may prompt you to allow Node.js through the firewall when the server first starts. Click **Allow access** and check both "Private networks" and "Public networks" if staff connect via public-facing Wi-Fi.

If the prompt doesn't appear and mobile devices can't reach the server, open Windows Defender Firewall and add an inbound rule for TCP port 3000.

---

## 7. User management

User accounts are managed from the Admin panel at `http://localhost:3000/admin`.

- **Add user** — set username, temporary password (user will be forced to change it on first login), and role
- **Reset password** — generates a new temporary password; user must change on next login
- **Delete user** — removes the account (does not affect report data attributed to that user)

### Roles

| Role | What they can do |
|------|-----------------|
| `monitor` | Create reports; add log entries; edit staff, passes, chores, and pass notices; cannot delete log entries or edit closed reports |
| `supervisor` | Everything a monitor can do, plus: edit open reports, delete log entries, submit UA requests |
| `admin` | Everything a supervisor can do, plus: user management, facility configuration, room management, log entry deletion on any report |

### Password policy

All passwords must be at least 8 characters and include uppercase, lowercase, a digit, and a symbol. This is enforced server-side on every password change.

---

## 8. Backup strategy

### What to back up

| Path | Contents | Priority |
|------|----------|----------|
| `data/shift.db` | All reports, residents, staff, passes, chores, users | **Critical** |
| `data/photos/` | Client and UA photos | High |

Everything else (code, `node_modules`, config) is replaceable. Only `data/` needs to be in your backup.

### Recommended approach

**Option A — Manual backup (minimum)**

Copy the `data/` folder to a USB drive or network share at the end of each week.

**Option B — Scheduled backup with Windows Task Scheduler**

Create a task that runs daily and copies `data/` to a backup location:

```batch
xcopy /E /I /Y "C:\ShiftPoint\data" "D:\Backups\ShiftPoint\data-%date:~-4,4%%date:~-7,2%%date:~0,2%"
```

**Option C — Cloud sync**

Place the entire ShiftPoint folder inside a OneDrive or Dropbox folder. Cloud sync will automatically back up `data/shift.db` whenever it changes.

> Do not run the server from inside a folder that is actively being synced while the server is running — this can corrupt the database. Either sync only the `data/` subfolder, or stop the server before syncing.

### Restoring from backup

1. Stop the server.
2. Replace `data/shift.db` with your backup copy.
3. Replace `data/photos/` with your backup photos folder.
4. Start the server.

---

## 9. Updating ShiftPoint

1. **Stop the server** (close the terminal window, or run `schtasks /end /tn "ShiftPointServer"`).
2. **Back up** `data/shift.db` and `data/photos/`.
3. **Replace the application files** — copy the new version over the existing folder. Do not delete the `data/` folder.
4. Run `npm install` to pick up any new dependencies.
5. **Start the server.**

Database schema migrations (new columns/tables) run automatically on startup via the `init()` function in `db.js`. No manual SQL is needed.

---

## 10. Troubleshooting

### Server won't start

**"node is not recognized"** — Node.js is not installed or not on the PATH. Download from https://nodejs.org and reinstall.

**"Cannot find module ..."** — dependencies are missing. Run `npm install` in the ShiftPoint folder.

**"EADDRINUSE: address already in use :3000"** — another process is using port 3000. Either stop the other process or change ShiftPoint's port in `server.js` (search for `3000`).

### Mobile can't connect

- Confirm the phone is on the same Wi-Fi network as the server.
- Check the IP address printed in the server console and use that exact address.
- Check Windows Firewall — add an inbound TCP rule for port 3000 if needed.
- If using HTTPS, the phone must accept the self-signed certificate before WebSocket connections will work.

### "Your connection is not private" (HTTPS)

Expected for self-signed certificates. Click **Advanced** → **Proceed** once per device. This is not a sign of an attack on your LAN.

### Lost admin password

Stop the server. Delete `data/shift.db`. Restart — a fresh database is created with new random credentials printed to the console. **All data will be lost.** Restore from backup if needed.

### Photos not showing

- Confirm `data/photos/` exists and is readable.
- If you moved the `data/` folder, check that the server has read/write access to the new location.
- Photos larger than 4 MB are rejected at upload time.

### Server stops unexpectedly

Check the terminal output for an error message. Common causes:
- Disk full (SQLite write fails)
- `data/shift.db` was deleted or corrupted while the server was running
- Node.js process killed by Windows (rare — can happen if the machine has very low RAM)

Restart the server. If crashes are frequent, check available disk space and RAM.
