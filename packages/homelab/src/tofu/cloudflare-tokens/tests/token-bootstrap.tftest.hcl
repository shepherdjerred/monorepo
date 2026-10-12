mock_provider "cloudflare" {}

variables {
  tofu_state_encryption_passphrase = "test-only-encryption-passphrase"
  cloudflare_api_tokens = {
    ci = {
      supersedes_id = "legacy-ci-token"
      name          = "CI replacement"
      policies = [{
        effect = "allow"
        permission_groups = [{
          id   = "c03055bc037c4ea9afb9a9f104b7b721"
          name = "SSL and Certificates Write"
        }]
        resources = { "com.cloudflare.api.account.zone.*" = "*" }
      }]
      vault_item_id = "ci-item"
      vault_field   = "CLOUDFLARE_API_TOKEN"
    }
    later = {
      managed       = false
      supersedes_id = "legacy-other-token"
      name          = "Deferred replacement"
      policies = [{
        effect = "allow"
        permission_groups = [{
          id   = "82e64a83756745bbbb1c9c2701bf816b"
          name = "DNS Read"
        }]
        resources = { "com.cloudflare.api.account.zone.*" = "*" }
      }]
      vault_item_id = "other-item"
      vault_field   = "CLOUDFLARE_API_TOKEN"
    }
  }
}

run "bootstrap_only_selected_consumer" {
  command = plan
  assert {
    condition = (
      keys(cloudflare_api_token.managed) == ["ci"] &&
      keys(nonsensitive(output.cloudflare_api_token_handoffs)) == ["ci"]
    )
    error_message = "Deferred consumers must neither create credentials nor publish token handoffs."
  }
}
