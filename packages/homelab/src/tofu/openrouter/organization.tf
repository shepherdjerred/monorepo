resource "openrouter_workspace" "managed" {
  for_each = var.openrouter_workspaces

  name                                = each.value.name
  slug                                = each.value.slug
  description                         = try(each.value.description, null)
  default_text_model                  = try(each.value.default_text_model, null)
  default_image_model                 = try(each.value.default_image_model, null)
  default_provider_sort               = try(each.value.default_provider_sort, null)
  io_logging_sampling_rate            = try(each.value.io_logging_sampling_rate, null)
  is_data_discount_logging_enabled    = try(each.value.is_data_discount_logging_enabled, null)
  is_observability_broadcast_enabled  = try(each.value.is_observability_broadcast_enabled, null)
  is_observability_io_logging_enabled = try(each.value.is_observability_io_logging_enabled, null)
}

resource "openrouter_guardrail" "managed" {
  for_each = var.openrouter_guardrails

  name              = each.value.name
  workspace_id      = try(openrouter_workspace.managed[each.value.workspace_key].id, null)
  description       = try(each.value.description, null)
  limit_usd         = try(each.value.limit_usd, null)
  reset_interval    = try(each.value.reset_interval, null)
  allowed_models    = try(each.value.allowed_models, null)
  allowed_providers = try(each.value.allowed_providers, null)
  ignored_models    = try(each.value.ignored_models, null)
  ignored_providers = try(each.value.ignored_providers, null)

  enforce_zdr_anthropic = try(each.value.enforce_zdr_anthropic, null)
  enforce_zdr_google    = try(each.value.enforce_zdr_google, null)
  enforce_zdr_openai    = try(each.value.enforce_zdr_openai, null)
  enforce_zdr_other     = try(each.value.enforce_zdr_other, null)
}

resource "openrouter_api_key" "managed" {
  for_each = var.openrouter_api_keys

  name                  = each.value.name
  workspace_id          = try(openrouter_workspace.managed[each.value.workspace_key].id, null)
  limit                 = try(each.value.limit, null)
  limit_reset           = try(each.value.limit_reset, null)
  include_byok_in_limit = try(each.value.include_byok_in_limit, null)
  disabled              = try(each.value.disabled, null)
  expires_at            = try(each.value.expires_at, null)
}

resource "openrouter_byok_credential" "managed" {
  for_each = var.openrouter_byok_credentials
  provider = openrouterbyok

  provider_name    = each.value.provider
  key              = var.openrouter_byok_keys[each.key]
  name             = try(each.value.name, null)
  workspace_id     = try(openrouter_workspace.managed[each.value.workspace_key].id, null)
  allowed_models   = try(each.value.allowed_models, null)
  allowed_user_ids = try(each.value.allowed_user_ids, null)
  disabled         = try(each.value.disabled, null)
  is_fallback      = try(each.value.is_fallback, null)
}

resource "onepassword_item" "api_keys" {
  for_each = var.openrouter_api_keys

  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = each.value.handoff_title

  section {
    label = "credentials"

    field {
      label = "OPENROUTER_API_KEY"
      value = openrouter_api_key.managed[each.key].key
      type  = "CONCEALED"
    }
  }
}

output "openrouter_workspace_ids" {
  description = "OpenRouter workspace IDs"
  value       = { for name, workspace in openrouter_workspace.managed : name => workspace.id }
}

output "openrouter_api_key_handoffs" {
  description = "1Password item IDs containing generated OpenRouter keys"
  value       = { for name, item in onepassword_item.api_keys : name => item.uuid }
}
