resource "cloudflare_api_token" "managed" {
  for_each = var.cloudflare_api_tokens

  name     = each.value.name
  policies = each.value.policies
  status   = try(each.value.status, null)

  expires_on = try(each.value.expires_on, null)
  not_before = try(each.value.not_before, null)

}

output "managed_cloudflare_api_tokens" {
  description = "Managed Cloudflare token IDs and generated values for 1Password handoff"
  sensitive   = true
  value = {
    for name, token in cloudflare_api_token.managed : name => {
      id    = token.id
      value = token.value
    }
  }
}

resource "onepassword_item" "managed_cloudflare_api_tokens" {
  for_each = {
    for name, token in var.cloudflare_api_tokens : name => token
    if try(token.handoff_title, null) != null
  }

  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = each.value.handoff_title

  section {
    label = "credentials"

    field {
      label = "CLOUDFLARE_API_TOKEN"
      value = cloudflare_api_token.managed[each.key].value
      type  = "CONCEALED"
    }
  }
}
