terraform {
  encryption {
    key_provider "pbkdf2" "posthog" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "posthog" {
      keys = key_provider.pbkdf2.posthog
    }

    state {
      method   = method.aes_gcm.posthog
      enforced = true
    }

    plan {
      method   = method.aes_gcm.posthog
      enforced = true
    }
  }
}
