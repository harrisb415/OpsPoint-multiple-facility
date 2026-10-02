output "app_url" {
  description = "OpsPoint's address"
  value       = google_cloud_run_v2_service.app.uri
}

output "setup_url" {
  description = "Where the first admin account is made"
  value       = "${google_cloud_run_v2_service.app.uri}/setup"
}

output "setup_code" {
  description = "Where the one-time setup code is"
  value       = "In the app's log a minute after it first starts (\"code XXXX-XXXX\"): gcloud run services logs read ${local.service} --region ${var.region} --limit 200, or the console's Cloud Run > ${local.service} > Logs."
}

output "custom_domain" {
  description = "Using your own domain"
  value       = "Cloud Run > Manage custom domains (where the region offers it), or a load balancer with a Google-managed certificate."
}

output "baa" {
  description = "Before real resident data goes in"
  value       = "Accept Google Cloud's HIPAA BAA (console: IAM & Admin > Privacy & Security): https://cloud.google.com/security/compliance/hipaa"
}
