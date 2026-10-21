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

run "committed_cache_uses_existing_user_token_provider" {
  command = plan
  variables {
    cloudflare_api_tokens = jsondecode(file("desired-state.json")).cloudflare_api_tokens
  }
  assert {
    condition = (
      keys(cloudflare_api_token.managed) == ["delivery-static-cache", "woodpecker"] &&
      keys(nonsensitive(output.cloudflare_api_token_handoffs)) == ["delivery-static-cache", "woodpecker"] &&
      length(cloudflare_api_token.managed["delivery-static-cache"].policies) == 1 &&
      cloudflare_api_token.managed["delivery-static-cache"].policies[0].effect == "allow" &&
      length(cloudflare_api_token.managed["delivery-static-cache"].policies[0].permission_groups) == 1 &&
      cloudflare_api_token.managed["delivery-static-cache"].policies[0].permission_groups[0].id == "e17beae8b8cb423a99b1730f21238bed" &&
      jsondecode(cloudflare_api_token.managed["delivery-static-cache"].policies[0].resources) == {
        "com.cloudflare.api.account.zone.3584931497b83f9359a3cc2983cc5cb4" = "*"
        "com.cloudflare.api.account.zone.ec9aaac18b0aae64b456e54773d11e66" = "*"
        "com.cloudflare.api.account.zone.bc4593740e6621ab2e64799c63441bfd" = "*"
        "com.cloudflare.api.account.zone.879487f81194d63121d0b8dddd16f08f" = "*"
        "com.cloudflare.api.account.zone.d4036b55fca60ca5f998866309e951d8" = "*"
        "com.cloudflare.api.account.zone.efb999158b3977e07b26f6a74809c80a" = "*"
      } &&
      cloudflare_api_token.managed["delivery-static-cache"].status == "active" &&
      cloudflare_api_token.managed["delivery-static-cache"].expires_on == "2027-10-17T23:59:59Z" &&
      nonsensitive(output.cloudflare_api_token_handoffs["delivery-static-cache"].vault_item_id) == "la7gkfl5eqtxiiv2hq3qujx2gi" &&
      nonsensitive(output.cloudflare_api_token_handoffs["delivery-static-cache"].vault_field) == "credential"
    )
    error_message = "The committed purge token must use the existing user-token provider, preserve the existing managed token and retain its exact expiry and credential handoff."
  }
}

run "s3_credential_hands_off_the_derived_r2_keys" {
  command = plan
  variables {
    cloudflare_api_tokens = {
      wal = {
        name = "Postgres WAL archive"
        policies = [{
          effect = "allow"
          permission_groups = [{
            id   = "2efd5506f9c8494dacb1fa10a3e7d5b6"
            name = "Workers R2 Storage Bucket Item Write"
          }]
          resources = { "com.cloudflare.edge.r2.bucket.account_postgres-wal" = "*" }
        }]
        vault_item_id = "wal-item"
        vault_field   = "credential"
        s3_credential = true
      }
      plain = {
        name = "Plain token"
        policies = [{
          effect = "allow"
          permission_groups = [{
            id   = "82e64a83756745bbbb1c9c2701bf816b"
            name = "DNS Read"
          }]
          resources = { "com.cloudflare.api.account.zone.*" = "*" }
        }]
        vault_item_id = "plain-item"
        vault_field   = "credential"
      }
    }
  }
  assert {
    condition = (
      keys(nonsensitive(output.cloudflare_api_token_handoffs)) == ["plain", "wal", "wal.s3-access-key-id", "wal.s3-secret-access-key"] &&
      nonsensitive(output.cloudflare_api_token_handoffs["wal.s3-access-key-id"].vault_item_id) == "wal-item" &&
      nonsensitive(output.cloudflare_api_token_handoffs["wal.s3-access-key-id"].vault_field) == "CLOUDFLARE_R2_ACCESS_KEY_ID" &&
      nonsensitive(output.cloudflare_api_token_handoffs["wal.s3-secret-access-key"].vault_item_id) == "wal-item" &&
      nonsensitive(output.cloudflare_api_token_handoffs["wal.s3-secret-access-key"].vault_field) == "CLOUDFLARE_R2_SECRET_ACCESS_KEY" &&
      nonsensitive(output.cloudflare_api_token_handoffs["wal"].vault_field) == "credential"
    )
    error_message = "A token with s3_credential must hand off its token plus the derived R2 access key id and secret access key to its own item; other tokens hand off only themselves."
  }
}
