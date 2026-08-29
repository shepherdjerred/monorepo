resource "cloudflare_api_token" "managed" {
  for_each = var.cloudflare_api_tokens

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

output "cloudflare_api_token_handoffs" {
  description = "Generated Cloudflare tokens and their existing 1Password rotation units"
  sensitive   = true
  value = {
    for name, token in cloudflare_api_token.managed : name => {
      api_token       = token.value
      supersedes_id   = var.cloudflare_api_tokens[name].supersedes_id
      vault_item_id   = var.cloudflare_api_tokens[name].vault_item_id
      vault_field     = var.cloudflare_api_tokens[name].vault_field
      vault_json_path = try(var.cloudflare_api_tokens[name].vault_json_path, null)
    }
  }
}
