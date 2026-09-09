#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  OpsPoint Postgres backup — HIPAA §164.308(a)(7)(ii)(A)
#
#  Runs on web-hestia, NOT on the database host. That is forced by the network:
#  db-mnemosyne has no outbound SSH (fw-heimdall blocks it) and the two
#  containers cannot SSH each other either. web-hestia is the only box that can
#  both reach Postgres on 5432 and reach me-box on 22, so it is the only place
#  the whole chain fits without a firewall change.
#
#  THE ORDER MATTERS:
#      dump  ->  RESTORE-VERIFY  ->  encrypt  ->  keep local  ->  push off-box
#
#  Verification happens BEFORE encryption, on purpose. Verifying afterwards
#  would require the decryption key to exist on a machine, which defeats the
#  encryption. Restoring first means what gets shipped is known to restore, and
#  the private key never has to live anywhere near the automation.
#
#  Encryption is age, to a public key. This host can create backups it cannot
#  read: whoever takes web-hestia gets the live database anyway, but not ninety
#  days of history.
#
#  The remote key is restricted (rrsync -wo, no pty, no forwarding), so this
#  host can push files to me-box and nothing else — no shell, and no deleting
#  what is already there. Remote pruning is me-box's own cron, deliberately
#  outside this host's reach.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

APP_DIR=/home/hestia/OpsPoint-multiple-facility
BK_DIR=/home/hestia/opspoint-backups
KEY_DIR=/home/hestia/.opspoint-backup
RECIPIENT_FILE=$KEY_DIR/recipient.txt
SSH_KEY=/home/hestia/.ssh/backup_mebox
REMOTE=harrisb415@34.83.185.255
LOCAL_KEEP_DAYS=14
STAMP=$(date +%Y%m%d-%H%M%S)

# Tables whose emptiness would mean a bad dump. Chosen because the app cannot
# function without rows in them: no users means nobody can log in.
VERIFY_TABLES="users clients audit_log settings"

mkdir -p "$BK_DIR"
cd "$APP_DIR" || exit 1
set -a; . ./.env; set +a
RECIPIENT=$(cat "$RECIPIENT_FILE")
# Same server and credentials as the facility DB, different database. Derived
# rather than stored so there is one less secret to keep in sync in .env.
VERIFY_URL="${DATABASE_URL%/*}/opspoint_verify"

log()  { echo "[$(date '+%F %T')] $*"; }
fail() { log "FAILED: $*"; audit_row "backup.failed" "$*"; exit 1; }

# Record the outcome in the app's own audit_log so backup health shows up in the
# OpsPoint audit viewer, not only in a log file nobody opens.
audit_row() {
  local action="$1"
  local detail="${2//\'/}"        # drop quotes rather than try to escape them
  # Fed on stdin, not with -c: psql only interpolates :'var' when reading from
  # stdin or a file, so -c would send the literal text ":'a'" and fail. Using
  # variables keeps the detail text from ever being parsed as SQL.
  # ts is timestamptz, so now() — to_char() returns text and would be rejected.
  psql "$DATABASE_URL" -q -v "a=$action" -v "d=$detail" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO audit_log (ts,actor_id,actor_name,ip,action,target_type,target_id,target_label,detail)
VALUES (now(),NULL,'system','127.0.0.1',:'a','database','','postgres',:'d');
SQL
}

# ── 1. dump ────────────────────────────────────────────────────────────────
# -Fc (custom format): compressed, and pg_restore can pull a SINGLE TABLE out of
# it. Most real restores are "someone deleted one thing", not "the box burned".
dump_one() {
  # Split deliberately: `local` expands ALL its arguments before assigning any
  # of them, so referencing ${name} on the same line reads it before it is set —
  # which under `set -u` aborts the run.
  local url="$1"
  local name="$2"
  local out="$BK_DIR/${name}-${STAMP}.dump"
  pg_dump -Fc --no-owner --no-privileges -f "$out" "$url" || fail "pg_dump $name"
  [ -s "$out" ] || fail "pg_dump $name produced an empty file"
  echo "$out"
}

# ── 2. verify by actually restoring ────────────────────────────────────────
# Into opspoint_verify, whose schema is dropped and rebuilt each run. The
# opspoint role owns that database, so this needs no superuser.
verify_dump() {
  local dump="$1" verify_url="$2"
  psql "$verify_url" -q -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' \
    >/dev/null 2>&1 || fail "could not reset the verification schema"
  pg_restore --no-owner --no-privileges -d "$verify_url" "$dump" >/dev/null 2>&1 \
    || fail "pg_restore rejected $(basename "$dump") — the dump is NOT restorable"
  for t in $VERIFY_TABLES; do
    local src dst
    src=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM $t" 2>/dev/null)
    dst=$(psql "$verify_url"   -tAc "SELECT count(*) FROM $t" 2>/dev/null)
    [ -n "$dst" ] || fail "table $t missing from the restored dump"
    [ "$src" = "$dst" ] || fail "row count mismatch on $t: live=$src restored=$dst"
    log "  verified $t: $dst rows"
  done
}

# ── 3. encrypt ─────────────────────────────────────────────────────────────
encrypt() {
  local plain="$1"
  age -r "$RECIPIENT" -o "${plain}.age" "$plain" || fail "age encrypt $(basename "$plain")"
  shred -u "$plain" 2>/dev/null || rm -f "$plain"   # never leave plaintext PHI at rest
  echo "${plain}.age"
}

log "=== backup start ==="

FAC=$(dump_one "$DATABASE_URL" opspoint)         || exit 1
log "dumped $(basename "$FAC") ($(du -h "$FAC" | cut -f1))"
verify_dump "$FAC" "$VERIFY_URL"
FAC_ENC=$(encrypt "$FAC")                        || exit 1

CEN=$(dump_one "$CENTRAL_DATABASE_URL" opscentral) || exit 1
log "dumped $(basename "$CEN") ($(du -h "$CEN" | cut -f1))"
CEN_ENC=$(encrypt "$CEN")                        || exit 1

# ── 4. local retention ─────────────────────────────────────────────────────
find "$BK_DIR" -maxdepth 1 -name '*.dump.age' -mtime +$LOCAL_KEEP_DAYS -delete
log "local copies: $(ls -1 "$BK_DIR"/*.dump.age 2>/dev/null | wc -l)"

# ── 5. push off-box ────────────────────────────────────────────────────────
# No --delete: the remote key is write-only and pruning is me-box's job. A
# compromise of this host therefore cannot erase the backup history.
rsync -az --timeout=120 -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o BatchMode=yes" \
  "$FAC_ENC" "$CEN_ENC" "$REMOTE:./" || fail "rsync to me-box"
log "pushed to me-box"

audit_row "backup.create" "opspoint + opscentral dumped, verified by restore, encrypted, pushed off-box"
log "=== backup OK ==="
