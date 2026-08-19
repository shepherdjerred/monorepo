variable "openrouter_workspaces" {
  description = "OpenRouter workspaces and their default routing settings"
  type = map(object({
    name                                = string
    slug                                = string
    description                         = optional(string)
    default_text_model                  = optional(string)
    default_image_model                 = optional(string)
    default_provider_sort               = optional(string)
    io_logging_sampling_rate            = optional(number)
    is_data_discount_logging_enabled    = optional(bool)
    is_observability_broadcast_enabled  = optional(bool)
    is_observability_io_logging_enabled = optional(bool)
  }))
  default = {}
}

variable "openrouter_guardrails" {
  description = "OpenRouter workspace guardrails"
  type = map(object({
    name                  = string
    workspace_key         = optional(string)
    description           = optional(string)
    limit_usd             = optional(number)
    reset_interval        = optional(string)
    allowed_models        = optional(set(string))
    allowed_providers     = optional(set(string))
    ignored_models        = optional(set(string))
    ignored_providers     = optional(set(string))
    enforce_zdr_anthropic = optional(bool)
    enforce_zdr_google    = optional(bool)
    enforce_zdr_openai    = optional(bool)
    enforce_zdr_other     = optional(bool)
  }))
  default = {}
}

variable "openrouter_api_keys" {
  description = "OpenRouter application API keys"
  type = map(object({
    name                  = string
    workspace_key         = optional(string)
    limit                 = optional(number)
    limit_reset           = optional(string)
    include_byok_in_limit = optional(bool)
    disabled              = optional(bool)
    expires_at            = optional(string)
    handoff_title         = string
  }))
  default = {}
}

variable "openrouter_byok_credentials" {
  description = "OpenRouter BYOK credential metadata; key values are injected separately from 1Password"
  type = map(object({
    provider         = string
    name             = optional(string)
    workspace_key    = optional(string)
    allowed_models   = optional(set(string))
    allowed_user_ids = optional(set(string))
    disabled         = optional(bool)
    is_fallback      = optional(bool)
  }))
  default = {}
}

variable "openrouter_byok_keys" {
  description = "OpenRouter BYOK raw credentials keyed by the metadata registry"
  type        = map(string)
  default     = {}
  sensitive   = true

  # Metadata and key material arrive as separate JSON env vars, so they can
  # drift. Every credential indexes this map, and without this check a metadata
  # entry with no key fails as an opaque invalid-index error.
  validation {
    condition = length(setsubtract(
      toset(keys(var.openrouter_byok_credentials)),
      toset(keys(var.openrouter_byok_keys)),
    )) == 0
    # Static message: the missing names derive from a sensitive map, and
    # OpenTofu rejects an error message built from sensitive values.
    error_message = "Every openrouter_byok_credentials entry needs a matching openrouter_byok_keys entry."
  }
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
