#!/usr/bin/env bash
# OpsPoint launcher (Linux/macOS). Windows uses run.bat.
# Runs bootstrap.js, which supervises server.js and auto-rolls-back a failed
# update. For boot-time autostart, point a systemd unit at this script.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found. Install from https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install
mkdir -p data data/photos
echo "OpsPoint — starting (supervised)…"
exec node bootstrap.js
