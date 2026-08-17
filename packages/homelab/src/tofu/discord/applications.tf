locals {
  discord_registry = jsondecode(file("${path.module}/bot-registry.json")).bots
  discord_registry_by_name = {
    for bot in local.discord_registry : bot.name => bot
  }
  discord_bots = {
    for name, settings in var.discord_bots : name => {
      # A name absent from the registry would otherwise fail as an invalid index
      # here, while locals are evaluated — before any precondition can explain
      # it. Resolve it to null and let the precondition below report it.
      expected_application_id = try(local.discord_registry_by_name[name].expected_application_id, null)
      settings                = settings
    }
  }
}

data "discord_current_application" "managed" {
  for_each = local.discord_bots
  provider = discord.bot[each.key]
}

resource "discord_application_settings" "managed" {
  for_each = local.discord_bots
  provider = discord.bot[each.key]

  description                       = try(each.value.settings.description, null)
  custom_install_url                = try(each.value.settings.custom_install_url, null)
  interactions_endpoint_url         = try(each.value.settings.interactions_endpoint_url, null)
  role_connections_verification_url = try(each.value.settings.role_connections_verification_url, null)
  tags                              = each.value.settings.tags

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = each.value.expected_application_id != null
      error_message = "Discord bot ${each.key} has no entry in bot-registry.json; add it there before managing it."
    }
    precondition {
      condition     = data.discord_current_application.managed[each.key].id == each.value.expected_application_id
      error_message = "Discord token for ${each.key} resolved to an unexpected application ID; refusing to manage it."
    }
  }
}

import {
  for_each = local.discord_bots
  to       = discord_application_settings.managed[each.key]
  id       = "self"
}

output "discord_application_ids" {
  description = "Application snowflakes discovered from each configured bot token"
  value = {
    for name, application in data.discord_current_application.managed : name => application.id
  }
}
