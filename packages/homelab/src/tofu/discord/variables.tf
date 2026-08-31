variable "discord_bots" {
  description = "Import-only Discord applications and their desired settings"
  type = map(object({
    application_name                  = string
    expected_application_id           = string
    vault_item_id                     = string
    description                       = optional(string)
    custom_install_url                = optional(string)
    interactions_endpoint_url         = optional(string)
    role_connections_verification_url = optional(string)
    tags                              = optional(set(string), [])
  }))

  validation {
    condition = length(setsubtract(toset(keys(var.discord_bots)), toset([
      "birmel", "starlight-beta", "starlight-prod", "scout-beta", "scout-prod", "minecraft"
      ]))) == 0 && length(setsubtract(toset([
      "birmel", "starlight-beta", "starlight-prod", "scout-beta", "scout-prod", "minecraft"
    ]), toset(keys(var.discord_bots)))) == 0
    error_message = "discord_bots must contain exactly the six statically configured bot applications."
  }
}

variable "discord_bot_tokens" {
  description = "Discord bot tokens keyed by the committed application name"
  type        = map(string)
  sensitive   = true
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
