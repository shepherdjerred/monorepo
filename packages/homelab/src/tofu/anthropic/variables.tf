variable "anthropic_workspaces" {
  description = "Anthropic workspaces to create and manage"
  type = map(object({
    name         = string
    workspace_id = optional(string)
  }))
  default = {}
}

variable "anthropic_api_keys" {
  description = "Anthropic organization or workspace API keys"
  type = map(object({
    api_key_id      = string
    name            = string
    status          = string
    vault_item_id   = optional(string)
    vault_field     = optional(string)
    vault_json_path = optional(string)
  }))
  default = {}

  validation {
    condition = alltrue([
      for key in values(var.anthropic_api_keys) :
      contains(["active", "inactive", "archived"], key.status) && (
        key.status == "archived" ?
        key.vault_item_id == null && key.vault_field == null && key.vault_json_path == null :
        try(length(key.vault_item_id), 0) > 0 && try(length(key.vault_field), 0) > 0
      )
    ])
    error_message = "Active and inactive keys require a vault rotation target; archived keys must retain only nonsecret metadata."
  }
}

variable "anthropic_workspace_members" {
  description = "Anthropic workspace membership and roles"
  type = map(object({
    workspace_key  = string
    user_id        = string
    workspace_role = string
  }))
  default = {}
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
