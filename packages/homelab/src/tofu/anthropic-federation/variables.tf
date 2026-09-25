variable "anthropic_federation_workspaces" {
  description = "One workspace per environment, so usage, cost, and rate limits attribute per environment"
  type = map(object({
    name = string
  }))
  default = {}
}

variable "anthropic_federation_issuer" {
  description = "The cluster's service-account token issuer, trusted by inline JWKS because it is not publicly reachable"
  type = object({
    name                     = string
    issuer_url               = string
    jwks_keys_json           = string
    max_jwt_lifetime_seconds = number
  })
}

variable "anthropic_federation_workloads" {
  description = "One service account and federation rule per app and environment, keyed app-env"
  type = map(object({
    workspace_key          = string
    namespace              = string
    token_lifetime_seconds = number
    onepassword_item_title = string
  }))
  default = {}

  validation {
    # Anthropic caps minted tokens at twice the remaining assertion lifetime.
    # Projected tokens live 600s, so anything above 1200 is not honoured, and
    # a lifetime longer than the kubelet's rotation interval invites a refresh
    # that re-presents a JWT already spent.
    condition = alltrue([
      for workload in values(var.anthropic_federation_workloads) :
      workload.token_lifetime_seconds >= 60 && workload.token_lifetime_seconds <= 1200
    ])
    error_message = "token_lifetime_seconds must be between 60 and 1200 to stay inside the projected token's rotation."
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
