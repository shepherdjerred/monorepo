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
