#!/usr/bin/env bash
# OpsPoint Central launcher (Linux/macOS). Windows uses run.bat.
# Runs bootstrap.js, which supervises server.js and auto-rolls-back a failed
# self-update.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not found."; exit 1; }
[ -d node_modules ] || npm install
mkdir -p data
echo "OpsPoint Central — starting (supervised) on :4000…"
exec node bootstrap.js
