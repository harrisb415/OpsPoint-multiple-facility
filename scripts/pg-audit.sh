#!/usr/bin/env bash
# =============================================================================
# pg-audit.sh — run the whole test suite against REAL Postgres.
#
# The suite normally runs on SQLite, which is exactly why Postgres-only bugs
# reached production: '' in a date column, a column one schema lacked, a
# sequence resync on the wrong connection. This rebuilds a SCRATCH database
# from migrations/pg before every test file, with OpsPoint's own migration
# runner (facility schema in `public`, HQ schema in `central_test`), checks
# schema parity, then runs each file with OPSPOINT_DB_DRIVER=pg. Nothing
# touches the app's data directory.
#
# Run on a host that can reach the database (web-hestia), from the repo root:
#   set -a; . ./.env; set +a          # DATABASE_URL etc.
#   scripts/pg-audit.sh               # scratch DB defaults to <same server>/opspoint_verify
#   AUDIT_DATABASE_URL=postgresql://…/some_test_db scripts/pg-audit.sh
#
# opspoint_verify is the backup job's restore target; it drops and rebuilds
# that schema every night anyway, so borrowing it between runs is harmless.
#
# The target's schema is DROPPED. The name guard below refuses anything that
# does not look like a scratch database — never point this at production.
# =============================================================================
set -u
cd "$(dirname "$0")/.."

SCRATCH="${AUDIT_DATABASE_URL:-${DATABASE_URL%/*}/opspoint_verify}"
dbname="${SCRATCH##*/}"; dbname="${dbname%%\?*}"
case "$dbname" in
  *verify*|*test*|*audit*|*scratch*) ;;
  *) echo "Refusing: '$dbname' does not look like a scratch database (need verify/test/audit/scratch in the name)."; exit 2 ;;
esac

export OPSPOINT_DB_DRIVER=pg DATABASE_URL="$SCRATCH" PGSSLMODE="${PGSSLMODE:-disable}"
export CENTRAL_DATABASE_URL="$SCRATCH?options=-c%20search_path%3Dcentral_test"
export OPSPOINT_DATA="$(mktemp -d /tmp/opsaudit.XXXXXX)"
unset OPSPOINT_BIND CENTRAL_BIND
trap 'rm -rf "$OPSPOINT_DATA"' EXIT

# Empty schemas, then OpsPoint's own migration runner (server/db/runner.js)
# applies migrations/pg — the fresh-install path, exercised before every file.
reset_schemas() {
  psql "$SCRATCH" -q -v ON_ERROR_STOP=1 \
    -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS central_test CASCADE; CREATE SCHEMA central_test;' \
    2>&1 | grep -v -e NOTICE -e DETAIL -e 'drop cascades' || true
  node server/cli/opspoint.js migrate >/tmp/pg-audit-mig.out 2>&1 \
    || { echo "!! migrate (facility) failed:"; cat /tmp/pg-audit-mig.out; return 1; }
  node server/cli/opspoint.js migrate --app central >/tmp/pg-audit-mig.out 2>&1 \
    || { echo "!! migrate (HQ) failed:"; cat /tmp/pg-audit-mig.out; return 1; }
}

echo "== scratch database: $dbname   code: $(git log --oneline -1 2>/dev/null || echo 'working tree')"
status=0
reset_schemas || exit 1

echo "== schema parity (migrations/pg vs the SQLite schema)"
node scripts/schema-parity.cjs || status=1

for f in tests/*.test.js; do
  case "$f" in
    # Builds its own raw SQLite database while the process is set to pg, so the
    # driver-aware helpers pick the wrong dialect — a harness artifact, not a bug.
    tests/clinical.unit.test.js) echo "== $f (skipped under pg: raw SQLite harness)"; continue ;;
  esac
  reset_schemas || { status=1; continue; }
  if timeout 300 npx jest --runInBand --colors=false "$f" > /tmp/pg-audit-jest.out 2>&1; then
    echo "== $f  $(grep -E '^Tests:' /tmp/pg-audit-jest.out)"
  else
    status=1
    echo "== $f  FAILED  $(grep -E '^Tests:' /tmp/pg-audit-jest.out)"
    grep -E '^\s+✕|^\s+\+ +"|● .* › ' /tmp/pg-audit-jest.out | head -40
  fi
done

[ "$status" = 0 ] && echo "== ALL CLEAN on Postgres" || echo "== FAILURES on Postgres (see above)"
exit $status
