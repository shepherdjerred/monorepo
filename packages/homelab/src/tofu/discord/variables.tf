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

  # A provider instance is created for every managed and retained name, and each
  # one indexes this map. Without this check a name missing a token fails as an
  # opaque invalid-index error while evaluating the provider configuration.
  validation {
    condition = length(setsubtract(
      toset(keys(var.discord_bots)),
      toset(keys(var.discord_bot_tokens)),
    )) == 0
    # The message stays static: the missing names derive from a sensitive map,
    # and OpenTofu rejects an error message built from sensitive values.
    error_message = "Every name in discord_bots needs a matching discord_bot_tokens entry."
  }
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
