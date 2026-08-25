variable "state_passphrase" {
  description = "Passphrase used to encrypt this stack's state and plan data."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "The PostHog state passphrase must contain at least 16 characters."
  }
}

locals {
  organization_id = "019fe7f8-ecce-0000-adca-fe93618022c7"
  project_id      = "549883"

  analytics_registry = jsondecode(file("${path.module}/../../../../../config/analytics-sites.json"))
  app_urls = [
    for site in local.analytics_registry.sites : "https://${site.hostname}"
  ]
  recording_domains = [
    for site in local.analytics_registry.sites : "https://${site.hostname}"
    if site.sessionReplay
  ]
}
