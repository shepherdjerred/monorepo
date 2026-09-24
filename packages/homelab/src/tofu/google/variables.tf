variable "google_billing_account_id" {
  description = "Cloud Billing account every LLM project bills to (XXXXXX-XXXXXX-XXXXXX)"
  type        = string

  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.google_billing_account_id))
    error_message = "google_billing_account_id must look like 012345-6789AB-CDEF01."
  }
}

variable "google_quota_project_id" {
  description = "Existing project that user credentials bill API quota to; created once by hand"
  type        = string
}

variable "google_workloads" {
  description = "One Gemini API project per app and environment, keyed app-env"
  type = map(object({
    project_id         = string
    display_name       = string
    monthly_budget_usd = number
    # Applied by hand in AI Studio's Spend tab; recorded here so the value
    # has one reviewed home. See google/budgets.tf for why.
    ai_studio_spend_cap_usd = number
    onepassword_targets = list(object({
      vault_item_id   = string
      vault_field     = string
      vault_json_path = optional(string)
    }))
  }))
  default = {}

  validation {
    condition = alltrue([
      for workload in values(var.google_workloads) :
      length(workload.project_id) >= 6 && length(workload.project_id) <= 30
    ])
    error_message = "Google project IDs must be 6 to 30 characters."
  }

  validation {
    # A cap above the budget would let the alert fire only after the money is
    # already spent past the point the cap should have stopped it.
    condition = alltrue([
      for workload in values(var.google_workloads) :
      workload.ai_studio_spend_cap_usd <= workload.monthly_budget_usd
    ])
    error_message = "ai_studio_spend_cap_usd must not exceed monthly_budget_usd."
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
