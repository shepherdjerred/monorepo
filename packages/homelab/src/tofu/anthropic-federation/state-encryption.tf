terraform {
  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.tofu_state_encryption_passphrase
    }

    method "aes_gcm" "encrypted" {
      keys = key_provider.pbkdf2.state
    }

    state {
      method   = method.aes_gcm.encrypted
      enforced = true
    }

    plan {
      method   = method.aes_gcm.encrypted
      enforced = true
    }
  }
}
