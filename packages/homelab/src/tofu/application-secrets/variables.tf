variable "tofu_state_encryption_passphrase" {
  description = "Unique application-secrets state passphrase supplied by the operator."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.tofu_state_encryption_passphrase) >= 16
    error_message = "State encryption requires a passphrase of at least 16 characters."
  }
}

variable "adoption_lengths" {
  description = "Nonsecret lengths inspected during adoption; retain for revision zero."
  type        = map(number)
  default     = {}
}

variable "adoption_keys" {
  description = "Explicit nonsecret keys to import, supplied only during initial adoption."
  type        = set(string)
  default     = []
}

variable "adoption_values" {
  description = "Existing values passed in memory by the operator; never in argv or files."
  type        = map(string)
  sensitive   = true
  default     = {}
}
