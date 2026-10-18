variable "tailscale_tailnet" {
  description = "Tailscale organization; '-' uses the operator credential's tailnet."
  type        = string
  default     = "-"
}

variable "tofu_state_encryption_passphrase" {
  description = "Unique tailscale-delivery state passphrase supplied by the operator."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.tofu_state_encryption_passphrase) >= 16
    error_message = "State encryption requires a passphrase of at least 16 characters."
  }
}
