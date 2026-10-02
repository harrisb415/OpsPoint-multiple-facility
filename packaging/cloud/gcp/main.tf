# OpsPoint on Google Cloud (profile gcp): one facility on Cloud Run (one instance, CPU always
# allocated), with Cloud SQL for PostgreSQL over the Cloud SQL connection (no open address),
# Cloud Storage for photos and Secret Manager for the secrets. See docs/CLOUD.md.
#
# Applying it again (a new image, a new size) keeps the database, the photos and every secret:
# the random values live in the Terraform state.

locals {
  sizes = {
    small            = { cpu = "1", memory = "1Gi", db_tier = "db-g1-small", db_gb = 20, backup_days = 7 }
    medium           = { cpu = "1", memory = "2Gi", db_tier = "db-custom-1-3840", db_gb = 50, backup_days = 14 }
    "multi-facility" = { cpu = "2", memory = "4Gi", db_tier = "db-custom-2-7680", db_gb = 100, backup_days = 35 }
  }
  s       = local.sizes[var.size]
  service = "opspoint-${var.name}"
  labels  = { app = "opspoint", facility = var.name }
  # An image on ghcr.io comes through the remote repository below.
  image = startswith(var.image, "ghcr.io/") ? "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.ghcr.repository_id}/${trimprefix(var.image, "ghcr.io/")}" : var.image
  # A socket URL: Cloud Run's Cloud SQL connection is a Unix socket under /cloudsql, encrypted by
  # the connection itself, so the app doesn't add TLS (PGSSLMODE=disable is allowed only on a
  # socket). No password in it: node-postgres takes it from PGPASSWORD.
  database_url = "postgresql://opspoint@localhost/opspoint?host=/cloudsql/${google_sql_database_instance.db.connection_name}"
  secrets      = toset(["session-secret", "vapid-seed", "postgres-password"])
}

resource "google_project_service" "apis" {
  for_each           = toset(["run.googleapis.com", "sqladmin.googleapis.com", "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "iam.googleapis.com", "storage.googleapis.com"])
  service            = each.key
  disable_on_destroy = false
}

# ── Image: ghcr.io through Artifact Registry ────────────────────────────────────────────────────
resource "google_artifact_registry_repository" "ghcr" {
  location      = var.region
  repository_id = "ghcr"
  description   = "ghcr.io, for the OpsPoint image"
  format        = "DOCKER"
  mode          = "REMOTE_REPOSITORY"
  labels        = local.labels
  remote_repository_config {
    description = "ghcr.io"
    docker_repository {
      custom_repository {
        uri = "https://ghcr.io"
      }
    }
  }
  depends_on = [google_project_service.apis]
}

# ── Secrets: made once, kept in the state, handed to the app by Cloud Run ───────────────────────
resource "random_password" "secret" {
  for_each = local.secrets
  length   = 64
  special  = false
}

resource "google_secret_manager_secret" "secret" {
  for_each  = local.secrets
  secret_id = "${var.name}-${each.key}"
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "secret" {
  for_each    = local.secrets
  secret      = google_secret_manager_secret.secret[each.key].id
  secret_data = random_password.secret[each.key].result
}

# ── Database ────────────────────────────────────────────────────────────────────────────────────
# Cloud SQL keeps a deleted instance's name for a week, so the name carries a random part.
resource "random_id" "db" {
  byte_length = 3
}

resource "google_sql_database_instance" "db" {
  name                = "${var.name}-db-${random_id.db.hex}"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true
  settings {
    edition                     = "ENTERPRISE"
    tier                        = local.s.db_tier
    availability_type           = "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = local.s.db_gb
    disk_autoresize             = true
    deletion_protection_enabled = true
    user_labels                 = local.labels
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = local.s.backup_days
      }
    }
    # A public address with no authorized networks: only the Cloud SQL connection (IAM-checked,
    # encrypted) gets in.
    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "opspoint" {
  name     = "opspoint"
  instance = google_sql_database_instance.db.name
}

resource "google_sql_user" "opspoint" {
  name     = "opspoint"
  instance = google_sql_database_instance.db.name
  password = random_password.secret["postgres-password"].result
}

# ── Photos ──────────────────────────────────────────────────────────────────────────────────────
resource "google_storage_bucket" "photos" {
  name                        = "${var.project_id}-${var.name}-photos"
  location                    = var.region
  labels                      = local.labels
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = true
  }
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }
  depends_on = [google_project_service.apis]
}

# ── The app's identity: its database connection, its secrets, its photos ────────────────────────
resource "google_service_account" "app" {
  account_id   = "${local.service}-app"
  display_name = "OpsPoint ${var.name}"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "app_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "app" {
  for_each  = local.secrets
  secret_id = google_secret_manager_secret.secret[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

resource "google_storage_bucket_iam_member" "app" {
  bucket = google_storage_bucket.photos.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.app.email}"
}

# ── The app ─────────────────────────────────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "app" {
  name     = local.service
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  labels   = local.labels

  template {
    service_account = google_service_account.app.email
    # One copy, always running: alerts and reminders run inside the app.
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    # The live connection stays open up to an hour, then the browser reconnects.
    timeout = "3600s"

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.db.connection_name]
      }
    }

    containers {
      image = local.image
      ports {
        container_port = 3000
      }
      resources {
        limits            = { cpu = local.s.cpu, memory = local.s.memory }
        cpu_idle          = false
        startup_cpu_boost = true
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "OPSPOINT_PROFILE"
        value = "gcp"
      }
      env {
        name  = "TZ"
        value = var.time_zone
      }
      env {
        name  = "OPSPOINT_SECRETS"
        value = "local"
      }
      env {
        name  = "DATABASE_URL"
        value = local.database_url
      }
      env {
        name  = "PGSSLMODE"
        value = "disable"
      }
      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.photos.name
      }
      env {
        name  = "VAPID_SUBJECT"
        value = var.contact_email == "" ? "https://${local.service}-${data.google_project.this.number}.${var.region}.run.app" : "mailto:${var.contact_email}"
      }
      # Cloud Run reads these from Secret Manager and hands them to the app as environment variables.
      env {
        name = "PGPASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secret["postgres-password"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "SESSION_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secret["session-secret"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "VAPID_SEED"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secret["vapid-seed"].secret_id
            version = "latest"
          }
        }
      }

      # /healthz fails only when the database can't be reached. The first start applies the
      # database schema, so it gets five minutes.
      startup_probe {
        period_seconds    = 10
        timeout_seconds   = 5
        failure_threshold = 30
        http_get {
          path = "/healthz"
          port = 3000
        }
      }
      liveness_probe {
        period_seconds    = 30
        timeout_seconds   = 5
        failure_threshold = 3
        http_get {
          path = "/healthz"
          port = 3000
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.app_sql,
    google_secret_manager_secret_iam_member.app,
    google_secret_manager_secret_version.secret,
    google_storage_bucket_iam_member.app,
    google_sql_database.opspoint,
    google_sql_user.opspoint,
  ]
}

data "google_project" "this" {
  project_id = var.project_id
}

# Anyone may reach the sign-in page; OpsPoint does its own sign-in.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
