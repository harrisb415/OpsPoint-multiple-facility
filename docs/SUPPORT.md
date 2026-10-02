# What OpsPoint supports

A small set of combinations is tested on every change and supported. Anything else may work, but
is not tested.

## Tested and supported

| Combination | How it is tested | Where |
|-------------|------------------|-------|
| Windows + SQLite | The full test suite | Every change, on Windows (and the CI Windows job) |
| Linux + SQLite | The full test suite | The CI Linux job |
| Linux + Postgres | The full suite against a real Postgres, plus schema parity (`scripts/pg-audit.sh`) | Every change, on the Postgres server production uses (and the CI Postgres job) |
| Object storage: Azure Blob, Amazon S3, Google Cloud Storage | The storage adapters against Azurite, MinIO and fake-gcs-server | The CI storage job; no cloud account needed |
| Fresh installs | OpsPoint Setup for Windows and `install.sh` end to end on clean machines, then the health check | Lab machines, before each release |
| Cloud templates | Offline: each template's settings through the startup check, and the clouds' own validators (`tests/cloud.test.js`); then each deployed to a throwaway account, health-checked, torn down | Every change; the deployments before each release that changes a template |

The permission audit (`node scripts/perm-audit.cjs`) runs inside the test suite, so every
combination gets it.

## Minimum versions

| Part | Minimum |
|------|---------|
| Node.js | 20 (the installers bring Node 24) |
| PostgreSQL | 14 |
| Windows | Windows 10 or Windows Server 2019, 64-bit |
| Linux | 64-bit glibc distributions with systemd: Debian 12, Ubuntu 22.04, RHEL / Rocky / Alma 9, or later |
| Browsers | The current Chrome, Edge, Firefox or Safari; iOS 16.4+ / Android Chrome for the phone app's push alerts |

## May work, not tested

- Alpine Linux or other musl distributions: the encrypted SQLite driver includes musl builds,
  but the installer and the service set-up are tested only on glibc distributions with systemd.
- 32-bit systems, ARM Windows.
- Postgres-compatible databases other than PostgreSQL itself.
- S3-compatible storage other than Amazon S3 and MinIO (Cloudflare R2, Backblaze B2, Wasabi):
  set `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`.
- Running several OpsPoint servers against one database (the health check warns when it sees
  more than one; shared live updates and a single job scheduler are roadmap phase 10).
- macOS as a server.

## Getting help

Run the health check first (`node server/cli/opspoint.js doctor`, or Admin › System health): it
says what it found and how to fix it. When reporting a problem, include its output and the
install's profile (`node server/cli/opspoint.js settings`, which hides every secret).
