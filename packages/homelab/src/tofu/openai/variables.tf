variable "openai_projects" {
  description = "OpenAI projects to create and manage"
  type = map(object({
    name            = string
    geography       = optional(string)
    external_key_id = optional(string)
  }))
  default = {}
}

variable "openai_service_accounts" {
  description = "OpenAI project service accounts whose generated keys are handed to 1Password"
  type = map(object({
    project_key   = string
    name          = string
    handoff_title = string
  }))
  default = {}
}

variable "openai_organization_users" {
  description = "Existing OpenAI organization users to manage after importing them"
  type = map(object({
    user_id           = string
    role              = optional(string)
    developer_persona = optional(string)
    technical_level   = optional(string)
  }))
  default = {}
}

variable "openai_project_users" {
  description = "OpenAI project user memberships and roles"
  type = map(object({
    project_key = string
    user_id     = string
    role_id     = string
  }))
  default = {}
}

variable "openai_project_spend_alerts" {
  description = "OpenAI project spend alerts"
  type = map(object({
    project_key                         = string
    threshold_amount                    = number
    currency                            = string
    interval                            = string
    notification_channel_type           = string
    notification_channel_recipients     = list(string)
    notification_channel_subject_prefix = optional(string)
  }))
  default = {}
}

variable "openai_groups" {
  description = "Existing OpenAI organization groups to import and manage"
  type = map(object({
    group_id = string
    name     = string
  }))
  default = {}
}

variable "openai_group_users" {
  description = "OpenAI organization group memberships"
  type = map(object({
    group_key = string
    user_id   = string
  }))
  default = {}
}

variable "openai_group_roles" {
  description = "OpenAI organization group role assignments"
  type = map(object({
    group_key = string
    role_id   = string
  }))
  default = {}
}

variable "openai_user_roles" {
  description = "OpenAI organization user role assignments"
  type = map(object({
    user_id = string
    role_id = string
  }))
  default = {}
}

variable "openai_roles" {
  description = "Custom OpenAI organization roles"
  type = map(object({
    role_name   = string
    permissions = list(string)
    description = optional(string)
  }))
  default = {}
}

variable "openai_certificates" {
  description = "OpenAI certificate metadata"
  type = map(object({
    certificate_id = string
    name           = optional(string)
  }))
  default = {}
}

variable "openai_certificate_values" {
  description = "OpenAI certificate PEM values keyed by certificate metadata"
  type        = map(string)
  default     = {}
  sensitive   = true

  # Metadata and PEM values arrive as separate JSON env vars, so they can drift.
  # Every certificate indexes this map, and without this check a metadata entry
  # with no PEM fails as an opaque invalid-index error.
  validation {
    condition = length(setsubtract(
      toset(keys(var.openai_certificates)),
      toset(keys(var.openai_certificate_values)),
    )) == 0
    # Static message: the missing names derive from a sensitive map, and
    # OpenTofu rejects an error message built from sensitive values.
    error_message = "Every openai_certificates entry needs a matching openai_certificate_values entry."
  }
}

variable "openai_organization_spend_alerts" {
  description = "OpenAI organization spend alerts"
  type = map(object({
    threshold_amount                    = number
    currency                            = string
    interval                            = string
    notification_channel_type           = string
    notification_channel_recipients     = list(string)
    notification_channel_subject_prefix = optional(string)
  }))
  default = {}
}

variable "openai_organization_spend_limits" {
  description = "OpenAI organization hard spend limits"
  type = map(object({
    threshold_amount = number
    currency         = string
    interval         = string
  }))
  default = {}
}

variable "openai_project_groups" {
  description = "OpenAI project group assignments"
  type = map(object({
    project_key = string
    group_key   = string
    role        = string
  }))
  default = {}
}

variable "openai_project_group_roles" {
  description = "OpenAI project group role assignments"
  type = map(object({
    project_key = string
    group_key   = string
    role_id     = string
  }))
  default = {}
}

variable "openai_project_data_retention" {
  description = "OpenAI project data retention controls"
  type = map(object({
    project_key = string
    type        = string
  }))
  default = {}
}

variable "openai_project_model_permissions" {
  description = "OpenAI project model allow/deny lists"
  type = map(object({
    project_key = string
    mode        = string
    model_ids   = list(string)
  }))
  default = {}
}

variable "openai_project_hosted_tool_permissions" {
  description = "OpenAI project hosted tool controls"
  type = map(object({
    project_key              = string
    file_search_enabled      = bool
    web_search_enabled       = bool
    image_generation_enabled = bool
    mcp_enabled              = bool
    code_interpreter_enabled = bool
  }))
  default = {}
}

variable "openai_project_spend_limits" {
  description = "OpenAI project hard spend limits"
  type = map(object({
    project_key      = string
    threshold_amount = number
    currency         = string
    interval         = string
  }))
  default = {}
}

variable "openai_project_rate_limits" {
  description = "OpenAI existing project rate limits"
  type = map(object({
    project_key                      = string
    rate_limit_id                    = string
    batch_1_day_max_input_tokens     = optional(number)
    max_audio_megabytes_per_1_minute = optional(number)
    max_images_per_1_minute          = optional(number)
    max_requests_per_1_day           = optional(number)
    max_requests_per_1_minute        = optional(number)
    max_tokens_per_1_minute          = optional(number)
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
