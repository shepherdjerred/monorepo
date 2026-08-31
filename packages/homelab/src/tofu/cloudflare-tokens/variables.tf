variable "cloudflare_api_tokens" {
  description = "Scoped Cloudflare child tokens and their existing rotation units"
  type = map(object({
    supersedes_id = string
    name          = string
    policies = list(object({
      effect = string
      permission_groups = list(object({
        id   = string
        name = string
      }))
      resources = map(string)
    }))
    condition = optional(object({
      request_ip = optional(object({
        in     = optional(list(string))
        not_in = optional(list(string))
      }))
    }))
    expires_on      = optional(string)
    not_before      = optional(string)
    status          = optional(string)
    vault_item_id   = string
    vault_field     = string
    vault_json_path = optional(string)
  }))
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
