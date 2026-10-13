variable "tofu_state_encryption_passphrase" {
  description = "Passphrase encrypting Docker Hub state and plans."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.tofu_state_encryption_passphrase) >= 16
    error_message = "The state encryption passphrase must contain at least 16 characters."
  }
}
