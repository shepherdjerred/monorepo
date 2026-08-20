variable "anthropic_admin_key" {
  description = "Anthropic organization admin key"
  type        = string
  sensitive   = true
}

variable "anthropic_workspaces" {
  description = "Anthropic workspaces to create and manage"
  type        = map(object({ name = string }))
  default     = {}
}

variable "anthropic_api_keys" {
  description = "Anthropic organization or workspace API keys"
  type = map(object({
    name          = string
    workspace_key = optional(string)
    status        = optional(string)
    handoff_title = string
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

variable "anthropic_invites" {
  description = "Anthropic organization invitations"
  type = map(object({
    email = string
    role  = string
  }))
  default = {}
}

variable "op_connect_url" {
  description = "1Password Connect server URL"
  type        = string
  default     = "http://localhost:8080"
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
