variable "tofu_state_encryption_passphrase" {
  description = "OpenTofu state and plan encryption passphrase from 1Password"
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.tofu_state_encryption_passphrase) >= 16
    error_message = "The OpenTofu state encryption passphrase must be at least 16 characters."
  }
}

terraform {
  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.tofu_state_encryption_passphrase
    }

    method "aes_gcm" "encrypted" {
      keys = key_provider.pbkdf2.state
    }

    method "unencrypted" "migration" {}

    state {
      method = method.aes_gcm.encrypted
      fallback {
        method = method.unencrypted.migration
      }
    }

    plan {
      method = method.aes_gcm.encrypted
      fallback {
        method = method.unencrypted.migration
      }
    }
  }
}
