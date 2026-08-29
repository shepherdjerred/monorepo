resource "anthropic_workspace" "managed" {
  for_each = var.anthropic_workspaces

  name = each.value.name
}

import {
  for_each = {
    for name, workspace in var.anthropic_workspaces : name => workspace
    if try(workspace.workspace_id, null) != null
  }
  to = anthropic_workspace.managed[each.key]
  id = each.value.workspace_id
}

resource "anthropic_api_key" "managed" {
  for_each = var.anthropic_api_keys

  name   = each.value.name
  status = each.value.status

  lifecycle {
    prevent_destroy = true
  }
}

import {
  for_each = var.anthropic_api_keys
  to       = anthropic_api_key.managed[each.key]
  id       = each.value.api_key_id
}

resource "anthropic_workspace_member" "managed" {
  for_each = var.anthropic_workspace_members

  workspace_id   = anthropic_workspace.managed[each.value.workspace_key].id
  user_id        = each.value.user_id
  workspace_role = each.value.workspace_role
}

output "anthropic_workspace_ids" {
  description = "Anthropic workspace IDs"
  value       = { for name, workspace in anthropic_workspace.managed : name => workspace.id }
}

output "anthropic_api_key_rotation_units" {
  description = "Imported Anthropic API key IDs and their existing 1Password rotation units"
  value = {
    for name, key in anthropic_api_key.managed : name => {
      api_key_id      = key.id
      vault_item_id   = var.anthropic_api_keys[name].vault_item_id
      vault_field     = var.anthropic_api_keys[name].vault_field
      vault_json_path = try(var.anthropic_api_keys[name].vault_json_path, null)
    }
  }
}
