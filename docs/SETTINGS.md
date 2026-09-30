# OpsPoint settings

<!-- Generated from server/settings/schema.js by `node server/cli/opspoint.js settings docs`.
     Do not edit by hand: tests/settings.test.js fails when this file and the schema disagree. -->

Every setting OpsPoint reads from its environment, declared once in `server/settings/schema.js`. A setting has one name everywhere: the environment variable, the key in `opspoint.config.json`, and the line in an installer's answers file.

## Where values come from

Later wins:

1. The built-in default (below).
2. The profile's default (`OPSPOINT_PROFILE`, below).
3. `opspoint.config.json` in the app folder, or the file `OPSPOINT_CONFIG` names.
4. Environment variables.
5. The provider's secret store (Key Vault, Secrets Manager, Secret Manager): roadmap phase 5.

`node server/cli/opspoint.js settings` lists every value and where it came from, with secrets hidden (`--app central` for HQ's). `--check` runs the startup check without starting anything: exit 0 when OpsPoint would start, 78 and the reasons when it would not.

## The startup check

The facility server (`server.js`) and HQ (`central/server.js`) check their settings before they create a folder, a key or a database. A missing or contradictory setting stops them with one sentence naming the fix, and exit code 78; `bootstrap.js` does not relaunch a server that exits with 78. Besides each value's type, the check makes sure that:

- The settings file is readable, valid JSON, one object, and holds only settings OpsPoint knows; a misspelt one stops startup with a suggestion.
- Every setting the profile requires is set (on azure, aws and gcp: SESSION_SECRET and the push keys), and every setting another one requires (DATABASE_URL with OPSPOINT_DB_DRIVER=pg; HQ's CENTRAL_DATABASE_URL likewise).
- No setting has a value its profile can't use: SQLite or photos on the local disk on azure, aws or gcp, or the in-app updater on those and docker.
- TZ is a zone Node knows (an unknown one silently becomes UTC), it is set on the managed and docker profiles, and when it is unset the machine's own zone is not UTC; the process's clock runs in TZ, and PGTZ, if set, equals it.
- The push keys are both set or both unset, and are one key pair.
- PGSSLROOTCERT exists; a managed profile never connects to Postgres unencrypted (except over a local socket); HQ's database is not the facility's.
- File storage has what it needs: an account or a connection string for azure-blob, a bucket for s3 and gcs, AWS keys in pairs, and an existing Google key file if one is named.
- On a managed or docker profile the app listens on every interface, not on 127.0.0.1, which the platform can't reach.

It warns, and starts anyway, on:

- An OPSPOINT_ or CENTRAL_ environment variable that is not a setting (probably a typo).
- A settings file holding secrets that other accounts can read (Linux and macOS).
- PGSSLMODE=disable to a database on another host.
- DATABASE_URL set while the driver is sqlite (it is ignored).
- An abbreviated TZ such as EST, which may ignore daylight saving.

## Profiles

A profile only sets defaults; any setting can still be set on its own. Unset, `OPSPOINT_PROFILE` is `windows-local` on Windows and `linux-local` anywhere else, which keep the defaults every install had before profiles existed.

| Profile | Deployment | Its defaults | Settings go in |
| --- | --- | --- | --- |
| `windows-local` | Windows, on-premises. A facility PC or Windows Server; OpsPoint runs its own server. | `OPSPOINT_OPEN_BROWSER`=`yes` | opspoint.config.json or the service environment |
| `linux-local` | Linux, on-premises. A Linux server, VM or container that OpsPoint runs itself (systemd or PM2). | none | opspoint.config.json or the service environment |
| `azure` | Azure, managed. App Service or Container Apps, with Azure Database for PostgreSQL and Blob Storage. | `OPSPOINT_DB_DRIVER`=`pg`, `OPSPOINT_TRUST_PROXY`=`1`, `OPSPOINT_UPDATES`=`platform`, `OPSPOINT_BACKUPS`=`provider`, `OPSPOINT_STORAGE`=`azure-blob` | the App Service or Container App settings |
| `aws` | AWS, managed. ECS Fargate behind an Application Load Balancer, with RDS or Aurora PostgreSQL and S3. | `OPSPOINT_DB_DRIVER`=`pg`, `OPSPOINT_TRUST_PROXY`=`1`, `OPSPOINT_UPDATES`=`platform`, `OPSPOINT_BACKUPS`=`provider`, `OPSPOINT_STORAGE`=`s3` | the ECS task definition |
| `gcp` | Google Cloud, managed. Cloud Run (at least one instance, CPU always allocated), with Cloud SQL for PostgreSQL and Cloud Storage. | `OPSPOINT_DB_DRIVER`=`pg`, `OPSPOINT_TRUST_PROXY`=`1`, `OPSPOINT_UPDATES`=`platform`, `OPSPOINT_BACKUPS`=`provider`, `OPSPOINT_STORAGE`=`gcs` | the Cloud Run service settings |
| `docker` | Docker. Docker Compose on any Linux host: a Postgres container (or an external one) and a data volume. | `OPSPOINT_DB_DRIVER`=`pg`, `OPSPOINT_TRUST_PROXY`=`loopback, uniquelocal`, `OPSPOINT_UPDATES`=`platform` | the compose file or its .env file |

## Settings

### Deployment

| Setting | Default | Required | What it is |
| --- | --- | --- | --- |
| `OPSPOINT_PROFILE` | inferred |  | Which kind of deployment this is; it picks the defaults for everything else. Unset: windows-local on Windows, linux-local anywhere else. One of `windows-local`, `linux-local`, `azure`, `aws`, `gcp`, `docker`. |
| `OPSPOINT_CONFIG` | — |  | Where the settings file is. Unset: opspoint.config.json in the app folder, when there is one. "none" ignores any settings file (the tests and the permission audit use this). Environment only. |
| `TZ` | — | everywhere (see the check below) | The facility's time zone, as an IANA name such as America/Los_Angeles. The server, the database session and the facility must agree, or evening entries are filed under the next day. Required everywhere: unset is accepted only when the machine's own zone is a real one, never an implicit UTC. |

### Server

| Setting | Default | Required | What it is |
| --- | --- | --- | --- |
| `PORT` | `3000` (HQ `4000`) |  | The port the app listens on (the facility 3000, HQ 4000). Cloud platforms usually set it themselves. |
| `OPSPOINT_BIND` | `0.0.0.0` |  | The network address the facility app listens on. 0.0.0.0 (every interface) lets staff phones reach it across the facility network; 127.0.0.1 makes it reachable only through a proxy on the same machine. |
| `OPSPOINT_TRUST_PROXY` | `loopback`; azure, aws, gcp: `1`; docker: `loopback, uniquelocal` |  | Which proxies may tell the app a client's real address and whether its connection was HTTPS: loopback (a proxy on the same machine), uniquelocal (private networks), an address or CIDR, or a hop count such as 1 behind a cloud load balancer. Wrong here means audit rows record the proxy, not the person. |
| `OPSPOINT_DATA` | data, in the app folder |  | The data folder: the SQLite database and its key, photos, backups, certificates and update files. |
| `OPSPOINT_JSON_LIMIT` | `50mb` |  | The largest request body accepted; photos arrive inside requests, so it is large. |
| `OPSPOINT_IDLE_MINS` | `30` |  | Minutes of inactivity before staff are signed out, until an admin sets it in Admin. |
| `OPSPOINT_OPEN_BROWSER` | `no`; windows-local: `yes` |  | Open the app in a browser on this machine when the server starts (on by default on windows-local). |
| `OPSPOINT_UPDATES` | `in-app`; azure, aws, gcp, docker: `platform` |  | How new versions arrive: in-app (Admin > System downloads, verifies and installs signed releases) or platform (a new container image or deployment; the in-app updater is switched off). One of `in-app`, `platform`. azure, aws, gcp, docker accept only `platform`. |

### Database

| Setting | Default | Required | What it is |
| --- | --- | --- | --- |
| `OPSPOINT_DB_DRIVER` | `sqlite`; azure, aws, gcp, docker: `pg` |  | Which database: sqlite (an encrypted file in the data folder) or pg (PostgreSQL). One of `sqlite`, `pg`. azure, aws, gcp accept only `pg`. |
| `OPSPOINT_DB` | opspoint.db, in the data folder |  | The SQLite database file (driver sqlite). Its encryption key is the .dbkey file beside it. |
| `OPSPOINT_ENCRYPT` | `yes` |  | Encrypt the SQLite database file: 1 (the default) or 0. With 0 an already encrypted database will not open; decrypt it deliberately instead. |
| `DATABASE_URL` | — | when OPSPOINT_DB_DRIVER=pg | **Secret.** The facility's PostgreSQL connection string, postgresql://user:password@host:5432/database (driver pg). |
| `PGSSLMODE` | `verify-full` |  | Encryption for Postgres connections: verify-full (the default: encrypted, certificate checked), require (encrypted, certificate not checked) or disable (plain; only on one host or a private network). One of `disable`, `require`, `verify-ca`, `verify-full`. |
| `PGSSLROOTCERT` | — |  | The CA certificate that signed the Postgres server's certificate, when it is not a public one (for example the Amazon RDS bundle). |
| `PGPOOL_MAX` | `10` |  | The most Postgres connections held open at once. |
| `OPSPOINT_MIGRATE` | `start` |  | When the Postgres schema changes in migrations/pg/ are applied: start (by OpsPoint as it starts, one instance at a time) or off (a deploy step runs `node server/cli/opspoint.js migrate` first, and OpsPoint refuses to start while one is missing). SQLite needs neither: the code builds its schema at every start. One of `start`, `off`. |
| `PGTZ` | — |  | The Postgres session time zone. Leave it unset so it follows TZ; if set, it must equal TZ. |

### File storage

| Setting | Default | Required | What it is |
| --- | --- | --- | --- |
| `OPSPOINT_STORAGE` | `local`; azure: `azure-blob`; aws: `s3`; gcp: `gcs` |  | Where photos (residents, UA cups) are stored: local (a folder on this machine), azure-blob (Azure Blob Storage), s3 (Amazon S3, or an S3-compatible service) or gcs (Google Cloud Storage). One of `local`, `azure-blob`, `s3`, `gcs`. azure, aws, gcp accept only `azure-blob`, `s3`, `gcs`. |
| `OPSPOINT_STORAGE_DIR` | the folder the SQLite database is in (the data folder) |  | For local storage: the folder whose photos/ subfolder holds the photos. |
| `OPSPOINT_STORAGE_PREFIX` | — |  | For cloud storage: a prefix for every object name, so several facilities can share one bucket or container (for example sunrise/). |
| `AZURE_STORAGE_ACCOUNT` | — |  | For azure-blob: the storage account's name, reached with the app's managed identity (which needs the Storage Blob Data Contributor role on the account). |
| `AZURE_STORAGE_CONNECTION_STRING` | — |  | **Secret.** For azure-blob without a managed identity: the account's connection string (AccountName and AccountKey), or Azurite's when testing. |
| `AZURE_CLIENT_ID` | — |  | For azure-blob with a user-assigned managed identity: that identity's client ID. Unset: the app's system-assigned identity. |
| `AZURE_STORAGE_CONTAINER` | `opspoint` |  | For azure-blob: the container that holds the files. It must already exist. |
| `S3_BUCKET` | — | when OPSPOINT_STORAGE=s3 | For s3: the bucket that holds the files. It must already exist. |
| `S3_REGION` | AWS_REGION, else us-east-1 |  | For s3: the bucket's region. |
| `S3_ENDPOINT` | — |  | For s3 on an S3-compatible service (MinIO, for example): its address, such as http://127.0.0.1:9000. Unset: Amazon S3. |
| `S3_FORCE_PATH_STYLE` | yes when S3_ENDPOINT is set |  | For s3: address objects as endpoint/bucket/name rather than bucket.endpoint/name (most S3-compatible services need this). |
| `AWS_REGION` | — |  | The AWS region (ECS sets it). S3_REGION follows it. |
| `AWS_ACCESS_KEY_ID` | — |  | For s3 without an ECS task role or EC2 instance role (or on MinIO): the access key, set together with AWS_SECRET_ACCESS_KEY. Unset: the role the platform provides. |
| `AWS_SECRET_ACCESS_KEY` | — |  | **Secret.** The secret that goes with AWS_ACCESS_KEY_ID. |
| `AWS_SESSION_TOKEN` | — |  | **Secret.** The session token that goes with temporary AWS keys. |
| `GCS_BUCKET` | — | when OPSPOINT_STORAGE=gcs | For gcs: the bucket that holds the files. It must already exist. |
| `GOOGLE_APPLICATION_CREDENTIALS` | — |  | For gcs outside Google Cloud: a service-account key file. Unset: the Cloud Run service's own service account (from the metadata server). |
| `GCS_ENDPOINT` | — |  | For gcs against an emulator (fake-gcs-server): its address, such as http://127.0.0.1:4443. Unset: Google Cloud Storage. |

### Backups

| Setting | Default | Required | What it is |
| --- | --- | --- | --- |
| `OPSPOINT_BACKUPS` | `recorded`; azure, aws, gcp: `provider` |  | How the health check knows backups happen: recorded (a backup.create entry in the audit log in the last 26 hours, written by the in-app SQLite backup or by an external job such as scripts/opspoint-backup.sh) or provider (the platform's point-in-time restore, which OpsPoint cannot see and takes on trust). One of `recorded`, `provider`. |

### Security

| Setting | Default | Required | What it is |
| --- | --- | --- | --- |
| `SESSION_SECRET` | — | on azure, aws, gcp | **Secret.** The key that signs sign-in cookies. Unset: generated once into OPSPOINT_SECRET_FILE. Managed platforms must set it, because their disk is wiped on restart and everyone would be signed out. |
| `OPSPOINT_SECRET_FILE` | secret.key, in the data folder |  | Where the generated session key is kept when SESSION_SECRET is unset. |

### Push alerts

| Setting | Default | Required | What it is |
| --- | --- | --- | --- |
| `VAPID_PUBLIC_KEY` | — | on azure, aws, gcp | Push alert public key. Set it with VAPID_PRIVATE_KEY, or leave both unset to generate a pair into the data folder. Changing it cuts off every subscribed phone. Make a pair with `node server/cli/opspoint.js keys`. |
| `VAPID_PRIVATE_KEY` | — | on azure, aws, gcp | **Secret.** Push alert private key, the other half of VAPID_PUBLIC_KEY. |
| `VAPID_SUBJECT` | `mailto:opspoint@localhost` |  | The contact push services are given, as mailto: or https:. A real address is better: some push services reject localhost. |

### Supervisor

| Setting | Default | Required | What it is |
| --- | --- | --- | --- |
| `OPSPOINT_HEALTH_PATH` | `/api/health` |  | The path bootstrap.js polls to decide that an updated server came up healthy. Also read by `bootstrap.js`. |
| `OPSPOINT_VERIFY_TIMEOUT` | `90000` |  | Milliseconds bootstrap.js waits for an updated server to answer before rolling the update back. Also read by `bootstrap.js`. |

### HQ

| Setting | Default | Required | What it is |
| --- | --- | --- | --- |
| `CENTRAL_DATA` | central/data, in the app folder |  | HQ's data folder: its SQLite database, certificates and update files. HQ only. |
| `CENTRAL_BIND` | `0.0.0.0` |  | The network address HQ listens on; 127.0.0.1 when a proxy on the same machine fronts it. HQ only. |
| `CENTRAL_DATABASE_URL` | — | when OPSPOINT_DB_DRIVER=pg | **Secret.** HQ's PostgreSQL connection string (driver pg). HQ keeps its own database, never the facility's. HQ only. |
| `CENTRAL_ADMIN_PW` | — |  | **Secret.** Password for HQ's first admin account on an empty HQ database; it must be changed at first sign-in. Unset: a random one is printed once. HQ only. |

## The settings file

`opspoint.config.json` is one JSON object of settings. Git never tracks it, since it may hold secrets. The top level is the facility app's; a `"central"` object holds HQ's own values, such as its `PORT`. Keys starting with `_` are ignored (use them for comments), and `$schema` is allowed.

```json
{
  "OPSPOINT_PROFILE": "linux-local",
  "TZ": "America/Chicago",
  "OPSPOINT_DB_DRIVER": "pg",
  "DATABASE_URL": "postgresql://opspoint:PASSWORD@db.internal:5432/opspoint",
  "PGSSLMODE": "verify-full",
  "central": {
    "PORT": 4000,
    "CENTRAL_DATABASE_URL": "postgresql://opspoint:PASSWORD@db.internal:5432/opscentral"
  }
}
```

On Linux, keep it readable only by the account OpsPoint runs as (`chmod 600`); the check warns otherwise. A `TZ` given only in the file is applied to the server's process when it starts, since Node takes its time zone from `TZ`.

## Not settings

These environment variables are how OpsPoint's own pieces talk to each other, or release tooling. They are not settings, and the check doesn't mistake them for typos: `OPSPOINT_BOOTSTRAP`, `OPSPOINT_BOOTSTRAP_BASE`, `OPSPOINT_BOOTSTRAP_ENTRY`, `OPSPOINT_BOOTSTRAP_DATA`, `OPSPOINT_RELEASE_KEY`, `OPSPOINT_RELEASE_KEY_FILE`.

These are set by the platform itself, so that the app can reach its storage without a key (an ECS task role, an Azure managed identity), and are read where they are used: `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, `AWS_CONTAINER_CREDENTIALS_FULL_URI`, `AWS_CONTAINER_AUTHORIZATION_TOKEN`, `IDENTITY_ENDPOINT`, `IDENTITY_HEADER`.
