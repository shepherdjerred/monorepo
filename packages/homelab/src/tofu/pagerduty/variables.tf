variable "pagerduty_token" {
  description = "PagerDuty REST API token (read/write) for managing on-call config. NOT the Events-v2 routing/integration key (which the PAGERDUTY_TOKEN name also feeds into Alertmanager elsewhere)."
  type        = string
  sensitive   = true

  validation {
    # Guard the PAGERDUTY_TOKEN name collision: the same env name is used
    # elsewhere for the Alertmanager Events-v2 routing key, which is a 32-char
    # hex string. A PagerDuty REST API token is ~20 alphanumerics, never 32 hex,
    # so reject that exact shape to stop a routing key from silently
    # authenticating the provider with the wrong credential. Case-insensitive
    # ([0-9a-fA-F]) so an upper/mixed-case routing key is rejected too.
    condition     = !can(regex("^[0-9a-fA-F]{32}$", var.pagerduty_token))
    error_message = "pagerduty_token looks like a 32-char Events-v2 routing key, not a REST API token. Set PAGERDUTY_TOKEN / TF_VAR_pagerduty_token to a PagerDuty REST API token (read/write)."
  }
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by the Dagger container to every stack, unused by PagerDuty resources)"
  type        = string
  sensitive   = true
  default     = ""
}
