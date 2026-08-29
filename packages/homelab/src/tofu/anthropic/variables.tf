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
    vault_item_id   = string
    vault_field     = string
    vault_json_path = optional(string)
  }))
  default = {}
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
