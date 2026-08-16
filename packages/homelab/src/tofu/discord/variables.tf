variable "discord_bots" {
  description = "True Discord bot applications whose settings should be managed"
  type = map(object({
    description                       = optional(string)
    custom_install_url                = optional(string)
    interactions_endpoint_url         = optional(string)
    role_connections_verification_url = optional(string)
    tags                              = optional(set(string), [])
  }))
  default = {}
}

variable "discord_bot_tokens" {
  description = "Discord bot tokens keyed by the bot registry name; injected from 1Password"
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "discord_provider_names" {
  description = "Previously managed bot names; retain retired names until their state is destroyed"
  type        = set(string)
  default     = []
}

variable "tofu_state_encryption_passphrase" {
  description = "OpenTofu state and plan encryption passphrase from 1Password"
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.tofu_state_encryption_passphrase) >= 16
    error_message = "The OpenTofu state encryption passphrase must be at least 16 characters."
  }
}
