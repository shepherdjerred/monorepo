resource "cloudflare_api_token" "managed" {
  for_each = {
    for name, token in var.cloudflare_api_tokens : name => token if token.managed
  }

  name = each.value.name
  policies = [
    for policy in each.value.policies : {
      effect = policy.effect
      permission_groups = [
        for permission_group in policy.permission_groups : {
          id = permission_group.id
        }
      ]
      resources = jsonencode(policy.resources)
    }
  ]
  condition  = try(each.value.condition, null)
  expires_on = try(each.value.expires_on, null)
  not_before = try(each.value.not_before, null)
  status     = try(each.value.status, null)
}

locals {
  # R2's S3 API authenticates with a credential derived from an API token:
  # the access key id is the token id and the secret access key is the
  # SHA-256 hex digest of the token value. A token that opts in hands both off
  # to fixed fields of its own 1Password item, as separate rotation units.
  r2_s3_credential_fields = {
    "s3-access-key-id"     = "CLOUDFLARE_R2_ACCESS_KEY_ID"
    "s3-secret-access-key" = "CLOUDFLARE_R2_SECRET_ACCESS_KEY"
  }
  r2_s3_credential_handoffs = merge([
    for name, token in cloudflare_api_token.managed : {
      for unit, field in local.r2_s3_credential_fields : "${name}.${unit}" => {
        value           = unit == "s3-access-key-id" ? token.id : sha256(token.value)
        supersedes_id   = null
        vault_item_id   = var.cloudflare_api_tokens[name].vault_item_id
        vault_field     = field
        vault_json_path = null
      }
    } if var.cloudflare_api_tokens[name].s3_credential
  ]...)
}

output "cloudflare_api_token_handoffs" {
  description = "Generated Cloudflare tokens and their existing 1Password rotation units"
  sensitive   = true
  value = merge({
    for name, token in cloudflare_api_token.managed : name => {
      api_token       = token.value
      supersedes_id   = var.cloudflare_api_tokens[name].supersedes_id
      vault_item_id   = var.cloudflare_api_tokens[name].vault_item_id
      vault_field     = var.cloudflare_api_tokens[name].vault_field
      vault_json_path = try(var.cloudflare_api_tokens[name].vault_json_path, null)
    }
  }, local.r2_s3_credential_handoffs)
}
