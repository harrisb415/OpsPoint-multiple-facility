# OpsPoint — Deployment Guide

OpsPoint supports two deployment modes:

- **Local (on-premise)** — runs on a Windows or Linux machine at the facility; staff access via LAN; self-signed TLS certificate. Sections 1–10 cover this path with instructions for both operating systems.
- **Cloud (self-hosted)** — runs on a Linux VPS or cloud instance (e.g. Google Cloud); nginx handles TLS with a Let's Encrypt certificate; accessible from anywhere over HTTPS. See [Section 11](#11-cloud-deployment-linux--nginx--lets-encrypt).

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [First run and credential setup](#3-first-run-and-credential-setup)
4. [Network access (mobile and desktop)](#4-network-access-mobile-and-desktop)
5. [HTTPS / WSS (recommended)](#5-https--wss-recommended)
6. [Autostart](#6-autostart)
7. [User management](#7-user-management)
8. [Backup strategy](#8-backup-strategy)
9. [Updating OpsPoint](#9-updating-opspoint)
10. [Troubleshooting](#10-troubleshooting)
11. [Cloud deployment (Linux + nginx + Let's Encrypt)](#11-cloud-deployment-linux--nginx--lets-encrypt)

---

## 1. Prerequisites

| Requirement | Windows | Linux |
|-------------|---------|-------|
| OS | Windows 10 or 11 | Ubuntu 20.04+ / Debian 11+ / any modern distro |
| Node.js LTS | Download from https://nodejs.org — click "LTS", run installer with all defaults | Install via NodeSource (see below) |
| Browser | Chrome or Edge recommended | Any modern browser |
| Network | All devices on the same Wi-Fi/LAN | All devices on the same Wi-Fi/LAN |

**Windows** — verify Node.js by opening a Command Prompt:

```
node --version
npm --version
```

**Linux** — install Node.js 20 via NodeSource, then verify:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

Both should print version numbers.

---

## 2. Installation

**Step 1 — Place the files**

**Windows:** Copy the OpsPoint folder to a permanent location, e.g. `C:\OpsPoint\`

**Linux:** Clone or copy to a permanent directory, e.g.:
```bash
git clone https://github.com/harrisb415/OpsPoint-multiple-facility.git /opt/opspoint
cd /opt/opspoint
```

**Step 2 — Install server dependencies**

```bash
npm install
```

**Step 3 — Install and build the React frontend**

```bash
cd client && npm install && npm run build && cd ..
```

This creates `client/dist/` — the compiled SPA served by Express. Only needs to be re-run when frontend code changes (e.g. after an update).

**Step 4 — Create data directories** (the server does this on first run, but you can create them manually)

**Windows:**
```
mkdir data
mkdir data\photos
```

**Linux:**
```bash
mkdir -p data/photos
```

> **Windows shortcut:** double-click **`run.bat`** — it handles steps 2–3 and starts the server in one step. No Linux equivalent; run the commands above manually or use PM2 (see [Section 6](#6-autostart)).

---

## 3. First run and credential setup

Start the server:

**Windows:** double-click **`run.bat`**, or in a Command Prompt:
```
node server.js
```

**Linux:**
```bash
node server.js
# or with PM2 (keeps running after logout):
pm2 start bootstrap.js --name opspoint
```

**On the very first run**, OpsPoint detects an empty database and creates three accounts with randomly-generated passwords. These are printed to the console in a box like this:

```
╔══════════════════════════════════════════╗
║        OpsPoint — First Run            ║
║  Default credentials (save these now):   ║
║                                          ║
║  admin      :  xK9#mPqL2rVw!nZs         ║
║  supervisor :  Bj7@cYtN5hXe^kRm         ║
║  pa         :  Wq3&dFuA8sGp$oHj         ║
║                                          ║
║  All accounts require a password change  ║
║  on first login.                         ║
╚══════════════════════════════════════════╝
```

**Copy these passwords before closing the window.** They are only displayed once.

Open Chrome and go to `http://localhost:3000`. Log in with the `admin` account and set your permanent password when prompted.

> If you lose all admin credentials, stop the server, delete `data/opspoint.db`, and restart. This resets the database — all data will be lost.

---

## 4. Network access (mobile and desktop)

The server prints the LAN IP address on startup, e.g.:

```
  Desktop : http://localhost:3000
  Mobile  : http://192.168.1.42:3000
```

- **Desktop staff** — open `http://localhost:3000` in Chrome on the server machine, or use the LAN IP from any computer on the same network.
- **Mobile staff** — open `http://192.168.1.42:3000` in the phone browser (Chrome recommended). The server detects mobile user-agents and redirects users with the `mobile.access` permission to the mobile interface automatically. Add to the home screen for a PWA-like experience.
- **Admin panel** — `http://localhost:3000/admin` (admin role required)
- **About / version info** — `http://localhost:3000/about` (any authenticated user)

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

## 6. Autostart

### Windows

Use the included startup installer to run the server automatically at boot (without anyone logged in).

**Step 1:** Right-click `install_startup.bat` and select **Run as administrator**.

The script will:
- Detect your Node.js installation path
- Create a `run_silent.bat` launcher
- Grant the `NetworkService` account access to the OpsPoint folder
- Register a Windows Scheduled Task named `OpsPointServer` that runs at boot

**Step 2:** The script starts the task immediately. Open `http://localhost:3000` to confirm it's running.

#### Managing the scheduled task

| Action | Command |
|--------|---------|
| Start now | `schtasks /run /tn "OpsPointServer"` |
| Stop | `schtasks /end /tn "OpsPointServer"` |
| Remove autostart | `schtasks /delete /tn "OpsPointServer" /f` |
| Check status | Task Scheduler → Task Scheduler Library → OpsPointServer |

You can also double-click **`start_server.bat`** to start the server on demand.

#### Fallback: startup folder

If the scheduled task cannot be registered (e.g. Group Policy restriction), place a shortcut to `run.bat` in the Windows Startup folder:

```
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
```

The server starts when you log in to Windows instead of at boot.

#### Firewall (Windows)

Windows Firewall may prompt you to allow Node.js when the server first starts. Click **Allow access** and check both network types. If mobile devices still can't reach the server, open Windows Defender Firewall and add an inbound rule for TCP port 3000.

---

### Linux (PM2)

PM2 is a process manager that keeps the server running in the background and restarts it automatically after a reboot.

**Install PM2:**

```bash
sudo npm install -g pm2
```

**Start OpsPoint:**

```bash
cd /opt/opspoint   # or wherever OpsPoint is installed
pm2 start bootstrap.js --name opspoint
pm2 save
```

**Register PM2 to start at boot** (follow the printed command):

```bash
pm2 startup
# run the command it prints, e.g.:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
```

#### Managing with PM2

| Action | Command |
|--------|---------|
| View logs | `pm2 logs opspoint` |
| Restart | `pm2 restart opspoint` |
| Stop | `pm2 stop opspoint` |
| Status | `pm2 status` |

#### Firewall (Linux — UFW)

```bash
sudo ufw allow 3000/tcp   # open port 3000 for LAN access
sudo ufw enable
```

---

## 7. User management

User accounts are managed from the Admin panel at `http://localhost:3000/admin`.

- **Add user** — set username, temporary password (user will be forced to change it on first login), and role
- **Reset password** — generates a new temporary password; user must change on next login
- **Delete user** — removes the account (does not affect report data attributed to that user)

### Roles

| Role | What they can do |
|------|-----------------|
| `pa` | Program Assistant — create and close reports; add log entries; edit statuses, residents, staff, chores, and pass notices; view reminders; acknowledge UA banners; log mail; access mobile |
| `supervisor` | Everything a PA can do, plus: delete log entries, submit UA requests, manage passes (add/edit/return), approve mail |
| `admin` | Full access: all supervisor permissions plus user management, facility configuration, room management, mail deletion, UA log deletion, and server administration |
| `case_manager` | Edit residents and staff; manage passes; submit UA requests; delete UA records; approve mail; mobile access |

Actual access is determined by the **permissions** array on each user, not the role alone. Roles are templates for the initial permission set. Permissions can be customised per user or per permission profile in Admin → Permission Profiles.

### Password policy

All passwords must be at least 8 characters and include uppercase, lowercase, a digit, and a symbol. This is enforced server-side on every password change.

---

## 8. Backup strategy

### What to back up

| Path | Contents | Priority |
|------|----------|----------|
| `data/opspoint.db` | All reports, residents, staff, passes, chores, users | **Critical** |
| `data/photos/` | Client and UA photos | High |

Everything else (code, `node_modules`, `client/dist/`, config) is replaceable. Only `data/` needs to be in your backup.

### Recommended approach

**Option A — Manual backup (minimum)**

Copy the `data/` folder to a USB drive or network share at the end of each week.

**Option B (Windows) — Scheduled backup with Task Scheduler**

Create a task that runs daily and copies `data/` to a backup location:

```batch
xcopy /E /I /Y "C:\OpsPoint\data" "D:\Backups\OpsPoint\data-%date:~-4,4%%date:~-7,2%%date:~0,2%"
```

**Option B (Linux) — Daily cron job**

```bash
crontab -e
# add this line:
0 3 * * * cp /opt/opspoint/data/opspoint.db /opt/opspoint/backups/db-$(date +\%Y\%m\%d).db
```

Or use `rsync` to copy the whole data directory to a remote location:

```bash
0 3 * * * rsync -a /opt/opspoint/data/ user@backup-host:/backups/opspoint/
```

**Option C (Windows) — Cloud sync**

Place the entire OpsPoint folder inside a OneDrive or Dropbox folder. Cloud sync will automatically back up `data/opspoint.db` whenever it changes.

> Do not run the server from inside a folder that is actively being synced while the server is running — this can corrupt the database. Either sync only the `data/` subfolder, or stop the server before syncing.

### Restoring from backup

1. Stop the server.
2. Replace `data/opspoint.db` with your backup copy.
3. Replace `data/photos/` with your backup photos folder.
4. Start the server.

---

## 9. Updating OpsPoint

**Step 1 — Stop the server**

Windows: close the terminal window, or run `schtasks /end /tn "OpsPointServer"`

Linux: `pm2 stop opspoint`

**Step 2 — Back up** `data/opspoint.db` and `data/photos/`

**Step 3 — Update the application files**

Windows: copy the new version over the existing folder (do not delete `data/`)

Linux (git):
```bash
cd /opt/opspoint
git pull
```

**Step 4 — Install any new server dependencies:**

```bash
npm install
```

**Step 5 — Rebuild the frontend** (required after any update that includes frontend changes):

```bash
cd client && npm install && npm run build && cd ..
```

**Step 6 — Start the server**

Windows: double-click `run.bat` or `schtasks /run /tn "OpsPointServer"`

Linux: `pm2 restart opspoint`

Database schema migrations run automatically on startup — no manual SQL needed.

---

## 10. Troubleshooting

### Server won't start

**"node is not recognized" / "command not found: node"** — Node.js is not installed or not on PATH.
- Windows: download from https://nodejs.org and reinstall
- Linux: install via NodeSource (see [Section 1](#1-prerequisites))

**"Cannot find module ..."** — dependencies are missing. Run `npm install` in the OpsPoint folder (and `cd client && npm install` if React modules are missing).

**"EADDRINUSE: address already in use :3000"** — another process is using port 3000.
- Windows: `netstat -ano | findstr :3000` to find the PID, then `taskkill /PID <pid> /F`
- Linux: `lsof -i :3000` to find the process, then `kill <pid>`

**Blank page / React app not loading** — the frontend may not have been built. Run `cd client && npm run build` and restart the server.

**Linux: server exits immediately** — check PM2 logs: `pm2 logs opspoint --lines 50`

### Mobile can't connect

- Confirm the phone is on the same Wi-Fi network as the server.
- Check the IP address printed in the server console and use that exact address.
- Firewall: Windows — add inbound TCP rule for port 3000. Linux — `sudo ufw allow 3000/tcp`
- If using HTTPS, the phone must accept the self-signed certificate before WebSocket connections will work.

### "Your connection is not private" (HTTPS)

Expected for self-signed certificates. Click **Advanced** → **Proceed** once per device. This is not a sign of an attack on your LAN.

### Lost admin password

Stop the server. Delete `data/opspoint.db`. Restart — a fresh database is created with new random credentials printed to the console. **All data will be lost.** Restore from backup if needed.

### Photos not showing

- Confirm `data/photos/` exists and is readable.
- If you moved the `data/` folder, check that the server has read/write access to the new location.
- Photos larger than 4 MB are rejected at upload time.

### Server stops unexpectedly

Check logs for an error message:
- Windows: scroll up in the terminal window
- Linux: `pm2 logs opspoint --lines 100`

Common causes:
- Disk full (SQLite write fails) — check with `df -h` (Linux) or File Explorer (Windows)
- `data/opspoint.db` deleted or corrupted while the server was running
- Out of memory — check with `free -h` (Linux) or Task Manager (Windows)

Restart and monitor. If crashes are frequent, check disk space and available RAM.

---

## 11. Cloud deployment (Linux + nginx + Let's Encrypt)

This section covers hosting OpsPoint on a Linux server (e.g. Google Cloud, DigitalOcean, Linode) with a real HTTPS certificate and external access via a custom domain.

### 11.1 Prerequisites

| Requirement | Notes |
|-------------|-------|
| Linux VPS or cloud VM | Ubuntu 22.04 LTS recommended |
| Domain or subdomain | Free option: [DuckDNS](https://www.duckdns.org) — e.g. `opspoint.duckdns.org` |
| Node.js 20 LTS | Install via NodeSource (see below) |
| nginx | TLS terminator — proxies HTTPS → Node.js HTTP |
| certbot | Obtains and auto-renews Let's Encrypt certificates |
| PM2 | Process manager — keeps the server running across reboots |
| Git | To clone and update the repo |

### 11.2 Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v20.x.x
```

### 11.3 Install nginx and certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 11.4 Clone and build OpsPoint

```bash
git clone https://github.com/harrisb415/OpsPoint-multiple-facility.git /opt/opspoint
cd /opt/opspoint
npm install
cd client && npm install && npm run build && cd ..
```

### 11.5 Point your domain to the server

If using DuckDNS:

1. Log in at [duckdns.org](https://www.duckdns.org) and create a subdomain (e.g. `opspoint`).
2. Set the IP to your server's external IP address.
3. Set up auto-renewal on the server so the IP stays current if it changes:

```bash
# Run every 5 minutes via cron
*/5 * * * * curl -s "https://www.duckdns.org/update?domains=opspoint&token=YOUR_TOKEN&ip=" > /dev/null
```

Confirm the domain resolves before continuing:

```bash
dig +short opspoint.duckdns.org
# should return your server's IP
```

### 11.6 Configure nginx

Create `/etc/nginx/sites-available/opspoint`:

```nginx
server {
    listen 80;
    server_name opspoint.duckdns.org;
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

Enable it and reload:

```bash
sudo ln -s /etc/nginx/sites-available/opspoint /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 11.7 Obtain a Let's Encrypt certificate

```bash
sudo certbot --nginx -d opspoint.duckdns.org
```

Certbot rewrites the nginx config to add SSL and sets up an HTTP→HTTPS redirect automatically. Certificates auto-renew via a systemd timer — no manual action needed.

Confirm auto-renewal works:

```bash
sudo certbot renew --dry-run
```

> **Do not** create a self-signed certificate (`node generate_cert.js`) on the cloud server. Node.js runs as plain HTTP internally; nginx handles TLS. If `data/cert.pem` and `data/key.pem` exist, delete them — the server will start in HTTP mode and nginx will handle HTTPS.

### 11.8 Start OpsPoint with PM2

```bash
sudo npm install -g pm2
cd /opt/opspoint
pm2 start bootstrap.js --name opspoint
pm2 save
pm2 startup   # follow the printed command to register PM2 as a systemd service
```

The server starts automatically on every reboot.

Useful PM2 commands:

| Action | Command |
|--------|---------|
| View logs | `pm2 logs opspoint` |
| Restart | `pm2 restart opspoint` |
| Stop | `pm2 stop opspoint` |
| Status | `pm2 status` |
| Restart all | `pm2 restart all` |

### 11.9 Open firewall ports (Google Cloud)

In the Google Cloud Console → VPC network → Firewall:

- Allow **TCP 80** (HTTP — needed for certbot renewals and redirect)
- Allow **TCP 443** (HTTPS — the public-facing port)

Port 3000 does **not** need to be open externally. nginx listens on 80/443 and proxies to Node.js on 3000 internally.

If using UFW instead:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 11.10 First run

On first start OpsPoint prints credentials to the console:

```bash
pm2 logs opspoint --lines 50
```

Look for the credential box (same format as local — see [Section 3](#3-first-run-and-credential-setup)). Open `https://opspoint.duckdns.org` in a browser and log in with the `admin` account to set your permanent password.

### 11.11 Updating (cloud)

```bash
cd /opt/opspoint
git pull
cd client && npm run build && cd ..
pm2 restart all
```

If `package.json` changed (new server dependencies):

```bash
npm install
pm2 restart all
```

### 11.12 Backup strategy (cloud)

The only file that must be backed up is `data/opspoint.db`. Options:

**Manual — copy to local machine:**
```bash
scp user@your-server:/opt/opspoint/data/opspoint.db ./backup-$(date +%Y%m%d).db
```

**Scheduled — daily cron on the server:**
```bash
0 3 * * * cp /opt/opspoint/data/opspoint.db /opt/opspoint/backups/db-$(date +\%Y\%m\%d).db
```

Also back up `data/photos/` if photo attachments are in use.

### 11.13 HQ Central (multi-facility)

If running OpsPoint HQ Central alongside the facility server:

- HQ Central runs as a separate Node.js process on port 4000.
- Create a second nginx site (`/etc/nginx/sites-available/hq-opspoint`) pointing to port 4000, with its own certbot certificate.
- Register it as a separate PM2 process: `pm2 start bootstrap.js --name hq-central --cwd /opt/hq-central`

```nginx
server {
    listen 80;
    server_name hq-opspoint.duckdns.org;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_set_header X-Real-IP         $remote_addr;
    }
}
```

Then: `sudo certbot --nginx -d hq-opspoint.duckdns.org`
