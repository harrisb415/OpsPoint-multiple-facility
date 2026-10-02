variable "project_id" {
  description = "The Google Cloud project OpsPoint goes in."
  type        = string
}

variable "region" {
  description = "Where the resources go, such as us-west1."
  type        = string
  default     = "us-west1"
}

variable "name" {
  description = "A short name for this facility's resources: lowercase letters, digits and dashes, 2 to 12 characters (for example sunrise)."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,11}$", var.name))
    error_message = "The name is 2 to 12 lowercase letters, digits and dashes, starting with a letter."
  }
}

variable "time_zone" {
  description = "The facility's time zone, as an IANA name such as America/Los_Angeles or America/Chicago. Dates are filed by it."
  type        = string
  validation {
    condition     = can(regex("^([A-Za-z]+(/[A-Za-z0-9_+-]+)+|UTC)$", var.time_zone))
    error_message = "The time zone is an IANA name such as America/Los_Angeles."
  }
}

variable "size" {
  description = "small: one facility up to about 50 residents. medium: a busy facility. multi-facility: several facilities' worth of staff on one app."
  type        = string
  default     = "small"
  validation {
    condition     = contains(["small", "medium", "multi-facility"], var.size)
    error_message = "The size is small, medium or multi-facility."
  }
}

variable "contact_email" {
  description = "Optional: an address push services can reach you at about this install's alerts. Blank: the app's own address."
  type        = string
  default     = ""
}

variable "image" {
  description = "The OpsPoint image. One on ghcr.io is pulled through an Artifact Registry remote repository, since Cloud Run can't pull from ghcr.io itself. Each release pins its own version."
  type        = string
  default     = "ghcr.io/harrisb415/opspoint:latest"
}
