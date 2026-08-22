resource "anthropic_workspace" "managed" {
  for_each = var.anthropic_workspaces

  name = each.value.name
}

resource "anthropic_api_key" "managed" {
  for_each = var.anthropic_api_keys

  name         = each.value.name
  workspace_id = each.value.workspace_key == null ? null : anthropic_workspace.managed[each.value.workspace_key].id
  status       = try(each.value.status, null)
}

resource "anthropic_workspace_member" "managed" {
  for_each = var.anthropic_workspace_members

  workspace_id   = anthropic_workspace.managed[each.value.workspace_key].id
  user_id        = each.value.user_id
  workspace_role = each.value.workspace_role
}

resource "anthropic_invite" "managed" {
  for_each = var.anthropic_invites

  email = each.value.email
  role  = each.value.role
}

resource "onepassword_item" "api_keys" {
  for_each = var.anthropic_api_keys

  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = each.value.handoff_title

  section {
    label = "credentials"

    field {
      label = "ANTHROPIC_API_KEY"
      value = anthropic_api_key.managed[each.key].key
      type  = "CONCEALED"
    }
  }
}

output "anthropic_workspace_ids" {
  description = "Anthropic workspace IDs"
  value       = { for name, workspace in anthropic_workspace.managed : name => workspace.id }
}

output "anthropic_api_key_handoffs" {
  description = "1Password item IDs containing generated Anthropic keys"
  value       = { for name, item in onepassword_item.api_keys : name => item.uuid }
}
