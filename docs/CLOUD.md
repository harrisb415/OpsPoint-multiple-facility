# OpsPoint in a cloud

One template per cloud puts one facility's OpsPoint on that cloud's own services: the app from the
OpsPoint image, a managed PostgreSQL database, object storage for photos and the cloud's secret
store. Each lives in `packaging/cloud/`; every release carries them pinned to its own image
(`opspoint-azure.json`, `opspoint-aws.yaml`, `opspoint-gcp.tar.gz`), and they are also in the
`cloud/` folder of [harrisb415/opspoint-releases](https://github.com/harrisb415/opspoint-releases).

| Cloud | Template | Runs on | Database | Photos | Secrets |
|-------|----------|---------|----------|--------|---------|
| Azure | Bicep (`azure/main.bicep`; `azuredeploy.json` in a release) | Container Apps | Database for PostgreSQL flexible server, on a private network | Blob Storage | Key Vault |
| AWS | CloudFormation (`aws/opspoint.yaml`) | ECS Fargate behind a load balancer | RDS for PostgreSQL, private subnets | S3 | Secrets Manager |
| Google Cloud | Terraform (`gcp/`), for Infrastructure Manager | Cloud Run | Cloud SQL for PostgreSQL, through the Cloud SQL connection | Cloud Storage | Secret Manager |

Deploying makes resources that cost money from the first hour; delete the resource group, stack
or deployment to stop them (the database is protected from that, see each cloud).

## What you choose

| | Azure | AWS | Google Cloud |
|---|---|---|---|
| A short name for the facility's resources (2–12 lowercase letters, digits, dashes) | `name` | `FacilityName` | `name` |
| The facility's time zone (IANA, such as `America/Los_Angeles`; dates are filed by it) | `timeZone` | `TimeZone` | `time_zone` |
| Size: `small`, `medium` or `multi-facility` | `size` | `Size` | `size` |
| Optional contact address for push services | `contactEmail` | `ContactEmail` | `contact_email` |
| The image (each release's template names its own version) | `image` | `Image` | `image` |
| Also | the resource group's region | `DomainName` (required), `HostedZoneId` | `project_id`, `region` |

| Size | Azure | AWS | Google Cloud |
|------|-------|-----|--------------|
| small (one facility, up to about 50 residents) | 0.5 CPU, 1 GiB; B1ms, 32 GB, backups 7 days | 0.5 vCPU, 1 GB; db.t4g.small, 20 GB, 7 days | 1 CPU, 1 GiB; db-g1-small, 20 GB, 7 backups |
| medium (a busy facility) | 1 CPU, 2 GiB; B2s, 64 GB, 14 days | 1 vCPU, 2 GB; db.t4g.medium, 50 GB, 14 days | 1 CPU, 2 GiB; 1 vCPU / 3.75 GB, 50 GB, 14 backups |
| multi-facility | 2 CPU, 4 GiB; D2ds_v5, 128 GB, 35 days | 2 vCPU, 4 GB; db.m7g.large, 100 GB, 35 days | 2 CPU, 4 GiB; 2 vCPU / 7.5 GB, 100 GB, 35 backups |

The database's disk grows on its own. Changing the size later is deploying again with the new one.

## What every template sets up

- **One copy of the app, always running.** Alerts, reminders and the other background jobs run
  inside the app, so it never scales to zero and never to two (see Known limits for the minute
  of an update on Azure and Google Cloud).
- **Three secrets, made once**: the session key, the push-key seed (`VAPID_SEED`; the app derives
  its push keys from it) and the database password. The platform hands them to the app as
  environment variables (`OPSPOINT_SECRETS=local`); deploying again keeps them, so nobody is
  signed out and no phone loses its alerts.
- **The database over TLS, never open to the internet**: Azure's on a private network (verified
  against the public CA), RDS verified against Amazon's CA bundle, which the image carries
  (`/app/certs/rds-global-bundle.pem`), Cloud SQL only through Cloud Run's Cloud SQL connection
  (encrypted by the connection, so the app's own TLS is off on that socket).
- **Photos in object storage**, reached with the app's own identity (no keys anywhere), deleted
  versions kept for 14 to 30 days.
- **The provider's backups** (`OPSPOINT_BACKUPS=provider`): daily, with point-in-time restore,
  kept as long as the size says. Setup's security step shows the restore window.
- **Health**: the platform probes `/healthz` and restarts the app when the database can't be
  reached; the first start applies the database schema and gets five minutes.
- In-app updates are off (`OPSPOINT_UPDATES=platform`): Admin › System says how this install is
  updated instead of offering the buttons.

## Azure

Needs a resource group, and on it **Owner** (or Contributor plus User Access Administrator): the
template gives the app's identity its rights.

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fharrisb415%2Fopspoint-releases%2Fmain%2Fcloud%2Fazure%2Fazuredeploy.json)

or from the command line:

```bash
az group create --name opspoint-sunrise --location westus3
az deployment group create --resource-group opspoint-sunrise \
  --template-file packaging/cloud/azure/main.bicep \
  --parameters name=sunrise timeZone=America/Los_Angeles size=small
```

- A deployment script (a short-lived container Azure runs and then removes) makes the secrets in
  Key Vault the first time and leaves them alone afterwards.
- **Deploying again into a deleted and re-created resource group of the same name** meets the
  old Key Vault, which Azure keeps for 7 days: `az keyvault purge --name kv-<name>-…` first (the
  name is in the error), or use another resource group name.
- Your own domain: Container App › Custom domains (Azure's free managed certificate); the output
  `customDomain` has the verification ID for the `asuid.` TXT record.
- Updating: deploy again with the new release's template, or only the image:
  `az containerapp update --name opspoint-sunrise --resource-group opspoint-sunrise --image ghcr.io/harrisb415/opspoint:<version>`.
- Logs: Container App › Log stream, or `az containerapp logs show --name opspoint-sunrise --resource-group opspoint-sunrise`.

## AWS

Needs a domain name for the address (`ops.sunrise.example`): the load balancer's HTTPS needs a
certificate, which AWS Certificate Manager issues for a domain it can check.

- With the domain in Route 53, give its `HostedZoneId`: the check and the address record are made
  for you.
- Without: while the stack is being created, Certificate Manager (in the same region) shows a
  CNAME record to add at your DNS provider; the stack waits for it. When it is done, point the
  name at the load balancer (the `DnsRecord` output).

Console: CloudFormation › Create stack › Upload a template file (`opspoint-aws.yaml` from the
release). A Launch Stack button needs the template on S3, which OpsPoint doesn't publish yet. Or:

```bash
aws cloudformation deploy --stack-name opspoint-sunrise --capabilities CAPABILITY_IAM \
  --template-file packaging/cloud/aws/opspoint.yaml \
  --parameter-overrides FacilityName=sunrise TimeZone=America/Los_Angeles DomainName=ops.sunrise.example HostedZoneId=Z0123456789ABC
```

- **The database has deletion protection** and leaves a final snapshot; the photos bucket is
  kept. Deleting the stack stops at the database until its protection is turned off (RDS ›
  Modify), on purpose.
- The app runs in public subnets with a public address (no NAT gateway to pay for), but only the
  load balancer may reach it; the database sits in private subnets.
- Updating: update the stack with the new release's template, or only the image (`aws
  cloudformation deploy` as above with `--parameter-overrides Image=ghcr.io/harrisb415/opspoint:<version>`;
  parameters left out keep their values). ECS stops the old copy before starting the new one:
  about a minute offline.
- Logs: CloudWatch › Log groups › `/opspoint/<name>` (90 days), or `aws logs tail /opspoint/sunrise --follow`.

## Google Cloud

Needs a project with billing, and rights to turn on services and grant roles (Owner is
simplest). An organization policy that limits sharing to your domain
(`iam.allowedPolicyMemberDomains`) refuses the last step, which lets anyone reach the sign-in
page (`allUsers` may invoke the service); allow it for this project or put a load balancer in
front.

With Infrastructure Manager (Terraform run by Google; its service account needs
`roles/config.agent` and the rights to make what the template makes):

```bash
gcloud infra-manager deployments apply \
  projects/PROJECT/locations/us-central1/deployments/opspoint-sunrise \
  --service-account=projects/PROJECT/serviceAccounts/infra-manager@PROJECT.iam.gserviceaccount.com \
  --git-source-repo=https://github.com/harrisb415/opspoint-releases \
  --git-source-directory=cloud/gcp --git-source-ref=v<version> \
  --input-values=project_id=PROJECT,region=us-west1,name=sunrise,time_zone=America/Los_Angeles
```

or with Terraform yourself (1.5 or newer) from `packaging/cloud/gcp`: `terraform init`, then
`terraform apply -var project_id=PROJECT -var name=sunrise -var time_zone=America/Los_Angeles`.
**The Terraform state holds the secrets**: keep it in a private bucket, never in a repository.

- Cloud Run can't pull from ghcr.io, so the image comes through an Artifact Registry remote
  repository (`ghcr`) the template makes.
- `/healthz` answers Google's own 404 from outside: Cloud Run keeps paths ending in `z` for itself.
  Its probes reach the app directly, so health and restarts work; an outside uptime check can
  watch the sign-in page instead.
- **The database has deletion protection** (in Cloud SQL and in Terraform): destroying stops there
  until both are turned off, on purpose.
- Your own domain: Cloud Run › Manage custom domains where the region offers it, or a load balancer
  with a Google-managed certificate.
- Updating: apply again with the new release (`--git-source-ref`) or only `image`.
- Logs: Cloud Run › the service › Logs, or `gcloud run services logs read opspoint-sunrise --region us-west1`.

## After deploying

1. Open the `setupUrl` output and enter the setup code from the app's log (`code XXXX-XXXX`, a
   minute after the first start; the `setupCode` output says where). It works once, for 24 hours.
   Past that, restart the app and the start makes a new one.
2. Setup walks the facility, rooms, staff and security steps. **Finishing asks you to confirm the
   provider's Business Associate Agreement is in place** (Azure: Microsoft's Product Terms; AWS:
   AWS Artifact › Agreements; Google Cloud: the console's HIPAA BAA) — the `baa` output links it.
   A BAA is required before real resident data goes in; it doesn't by itself make an organization
   HIPAA compliant.
3. Put the facility's own domain in front (above) before handing the address out.

## Known limits

- **A minute of two copies on Azure and Google Cloud.** Both start a new revision before stopping
  the old one, so during an update both may run their background jobs (a reminder could be sent
  twice). AWS stops the old one first.
- One facility per deployment, one region, no standby database (each size can be raised; the
  database can be made zone-redundant in the portal or console).
- Real-account deployments of these templates haven't been run yet: they are checked offline
  (below) and against the app's own startup check.

## Checking the templates

`npx jest tests/cloud.test.js` runs every template's settings through the app's startup check for
its profile, checks the secrets, the single copy, the health probes, the image and the RDS
bundle, runs the Azure secrets script against a stand-in `az`, and runs `bicep build`/`lint`,
`cfn-lint` and `terraform fmt`/`validate` where they are installed. Nothing is deployed.
