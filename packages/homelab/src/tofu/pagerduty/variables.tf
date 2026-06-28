variable "pagerduty_token" {
  description = "PagerDuty REST API token (read/write) for managing on-call config"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by the Dagger container to every stack, unused by PagerDuty resources)"
  type        = string
  sensitive   = true
  default     = ""
}
