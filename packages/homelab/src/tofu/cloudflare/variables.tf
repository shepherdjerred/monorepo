variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
  sensitive   = true
}

variable "cloudflare_api_tokens" {
  description = "Scoped child API tokens to manage with the bootstrap token"
  type = map(object({
    name = string
    policies = list(object({
      effect            = string
      permission_groups = list(object({ id = string }))
      resources         = string
    }))
    expires_on    = optional(string)
    not_before    = optional(string)
    status        = optional(string)
    handoff_title = optional(string)
  }))
  default = {}
}

variable "op_connect_url" {
  description = "1Password Connect server URL"
  type        = string
  default     = "http://localhost:8080"
}
