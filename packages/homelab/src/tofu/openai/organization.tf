resource "openai_project" "managed" {
  for_each = var.openai_projects

  name            = each.value.name
  geography       = try(each.value.geography, null)
  external_key_id = try(each.value.external_key_id, null)
}

resource "openai_organization_user" "managed" {
  for_each = var.openai_organization_users

  role              = try(each.value.role, null)
  developer_persona = try(each.value.developer_persona, null)
  technical_level   = try(each.value.technical_level, null)

  lifecycle {
    prevent_destroy = true
  }
}

resource "openai_group" "managed" {
  for_each = var.openai_groups

  name = each.value.name

  lifecycle {
    prevent_destroy = true
  }
}

import {
  for_each = var.openai_groups
  to       = openai_group.managed[each.key]
  id       = each.value.group_id
}

resource "openai_group_user" "managed" {
  for_each = var.openai_group_users

  group_id = openai_group.managed[each.value.group_key].id
  user_id  = each.value.user_id
}

resource "openai_group_role" "managed" {
  for_each = var.openai_group_roles

  group_id = openai_group.managed[each.value.group_key].id
  role_id  = each.value.role_id
}

resource "openai_user_role" "managed" {
  for_each = var.openai_user_roles

  user_id = each.value.user_id
  role_id = each.value.role_id
}

resource "openai_role" "managed" {
  for_each = var.openai_roles

  role_name   = each.value.role_name
  permissions = each.value.permissions
  description = try(each.value.description, null)
}

resource "openai_certificate" "managed" {
  for_each = var.openai_certificates

  certificate = var.openai_certificate_values[each.key]
  name        = try(each.value.name, null)
}

import {
  for_each = var.openai_certificates
  to       = openai_certificate.managed[each.key]
  id       = each.value.certificate_id
}

resource "openai_organization_spend_alert" "managed" {
  for_each = var.openai_organization_spend_alerts

  threshold_amount                    = each.value.threshold_amount
  currency                            = each.value.currency
  interval                            = each.value.interval
  notification_channel_type           = each.value.notification_channel_type
  notification_channel_recipients     = each.value.notification_channel_recipients
  notification_channel_subject_prefix = try(each.value.notification_channel_subject_prefix, null)
}

resource "openai_organization_spend_limit" "managed" {
  for_each = var.openai_organization_spend_limits

  threshold_amount = each.value.threshold_amount
  currency         = each.value.currency
  interval         = each.value.interval
}

import {
  for_each = var.openai_organization_users
  to       = openai_organization_user.managed[each.key]
  id       = each.value.user_id
}

resource "openai_project_user_role" "managed" {
  for_each = var.openai_project_users

  project_id = openai_project.managed[each.value.project_key].id
  user_id    = each.value.user_id
  role_id    = each.value.role_id
}

resource "openai_project_spend_alert" "managed" {
  for_each = var.openai_project_spend_alerts

  project_id                          = openai_project.managed[each.value.project_key].id
  threshold_amount                    = each.value.threshold_amount
  currency                            = each.value.currency
  interval                            = each.value.interval
  notification_channel_type           = each.value.notification_channel_type
  notification_channel_recipients     = each.value.notification_channel_recipients
  notification_channel_subject_prefix = try(each.value.notification_channel_subject_prefix, null)
}

resource "openai_project_group" "managed" {
  for_each = var.openai_project_groups

  project_id = openai_project.managed[each.value.project_key].id
  group_id   = openai_group.managed[each.value.group_key].id
  role       = each.value.role
}

resource "openai_project_group_role" "managed" {
  for_each = var.openai_project_group_roles

  project_id = openai_project.managed[each.value.project_key].id
  group_id   = openai_group.managed[each.value.group_key].id
  role_id    = each.value.role_id
}

resource "openai_project_data_retention" "managed" {
  for_each = var.openai_project_data_retention

  project_id = openai_project.managed[each.value.project_key].id
  type       = each.value.type
}

resource "openai_project_model_permissions" "managed" {
  for_each = var.openai_project_model_permissions

  project_id = openai_project.managed[each.value.project_key].id
  mode       = each.value.mode
  model_ids  = each.value.model_ids
}

resource "openai_project_hosted_tool_permissions" "managed" {
  for_each = var.openai_project_hosted_tool_permissions

  project_id               = openai_project.managed[each.value.project_key].id
  file_search_enabled      = each.value.file_search_enabled
  web_search_enabled       = each.value.web_search_enabled
  image_generation_enabled = each.value.image_generation_enabled
  mcp_enabled              = each.value.mcp_enabled
  code_interpreter_enabled = each.value.code_interpreter_enabled
}

resource "openai_project_spend_limit" "managed" {
  for_each = var.openai_project_spend_limits

  project_id       = openai_project.managed[each.value.project_key].id
  threshold_amount = each.value.threshold_amount
  currency         = each.value.currency
  interval         = each.value.interval
}

resource "openai_project_rate_limit" "managed" {
  for_each = var.openai_project_rate_limits

  project_id                       = openai_project.managed[each.value.project_key].id
  rate_limit_id                    = each.value.rate_limit_id
  batch_1_day_max_input_tokens     = try(each.value.batch_1_day_max_input_tokens, null)
  max_audio_megabytes_per_1_minute = try(each.value.max_audio_megabytes_per_1_minute, null)
  max_images_per_1_minute          = try(each.value.max_images_per_1_minute, null)
  max_requests_per_1_day           = try(each.value.max_requests_per_1_day, null)
  max_requests_per_1_minute        = try(each.value.max_requests_per_1_minute, null)
  max_tokens_per_1_minute          = try(each.value.max_tokens_per_1_minute, null)
}

resource "openai_project_service_account" "service_accounts" {
  for_each = var.openai_service_accounts
  provider = openaikeys

  project_id = openai_project.managed[each.value.project_key].id
  name       = each.value.name
}

resource "onepassword_item" "service_accounts" {
  for_each = var.openai_service_accounts

  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = each.value.handoff_title

  section {
    label = "credentials"

    field {
      label = "OPENAI_API_KEY"
      value = openai_project_service_account.service_accounts[each.key].api_key
      type  = "CONCEALED"
    }
  }
}

output "openai_project_ids" {
  description = "OpenAI project IDs"
  value       = { for name, project in openai_project.managed : name => project.id }
}

output "openai_service_account_handoffs" {
  description = "1Password item IDs containing generated OpenAI service-account keys"
  value       = { for name, item in onepassword_item.service_accounts : name => item.uuid }
}
