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

data "discord_current_application" "birmel" {
  count    = contains(keys(local.discord_bots), "birmel") ? 1 : 0
  provider = discord.birmel
}

data "discord_current_application" "starlight_beta" {
  count    = contains(keys(local.discord_bots), "starlight-beta") ? 1 : 0
  provider = discord.starlight_beta
}

data "discord_current_application" "starlight_prod" {
  count    = contains(keys(local.discord_bots), "starlight-prod") ? 1 : 0
  provider = discord.starlight_prod
}

data "discord_current_application" "scout_beta" {
  count    = contains(keys(local.discord_bots), "scout-beta") ? 1 : 0
  provider = discord.scout_beta
}

data "discord_current_application" "scout_prod" {
  count    = contains(keys(local.discord_bots), "scout-prod") ? 1 : 0
  provider = discord.scout_prod
}

data "discord_current_application" "minecraft" {
  count    = contains(keys(local.discord_bots), "minecraft") ? 1 : 0
  provider = discord.minecraft
}

resource "discord_application_settings" "birmel" {
  count    = contains(keys(local.discord_bots), "birmel") ? 1 : 0
  provider = discord.birmel

  description                       = try(local.discord_bots["birmel"].settings.description, null)
  custom_install_url                = try(local.discord_bots["birmel"].settings.custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["birmel"].settings.interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["birmel"].settings.role_connections_verification_url, null)
  tags                              = try(local.discord_bots["birmel"].settings.tags, [])

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = local.discord_bots["birmel"].expected_application_id != null
      error_message = "Discord bot birmel has no entry in bot-registry.json; add it there before managing it."
    }
    precondition {
      condition     = data.discord_current_application.birmel[0].id == local.discord_bots["birmel"].expected_application_id
      error_message = "Discord token for birmel resolved to an unexpected application ID; refusing to manage it."
    }
  }
}

resource "discord_application_settings" "starlight_beta" {
  count    = contains(keys(local.discord_bots), "starlight-beta") ? 1 : 0
  provider = discord.starlight_beta

  description                       = try(local.discord_bots["starlight-beta"].settings.description, null)
  custom_install_url                = try(local.discord_bots["starlight-beta"].settings.custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["starlight-beta"].settings.interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["starlight-beta"].settings.role_connections_verification_url, null)
  tags                              = try(local.discord_bots["starlight-beta"].settings.tags, [])

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = local.discord_bots["starlight-beta"].expected_application_id != null
      error_message = "Discord bot starlight-beta has no entry in bot-registry.json; add it there before managing it."
    }
    precondition {
      condition     = data.discord_current_application.starlight_beta[0].id == local.discord_bots["starlight-beta"].expected_application_id
      error_message = "Discord token for starlight-beta resolved to an unexpected application ID; refusing to manage it."
    }
  }
}

resource "discord_application_settings" "starlight_prod" {
  count    = contains(keys(local.discord_bots), "starlight-prod") ? 1 : 0
  provider = discord.starlight_prod

  description                       = try(local.discord_bots["starlight-prod"].settings.description, null)
  custom_install_url                = try(local.discord_bots["starlight-prod"].settings.custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["starlight-prod"].settings.interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["starlight-prod"].settings.role_connections_verification_url, null)
  tags                              = try(local.discord_bots["starlight-prod"].settings.tags, [])

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = local.discord_bots["starlight-prod"].expected_application_id != null
      error_message = "Discord bot starlight-prod has no entry in bot-registry.json; add it there before managing it."
    }
    precondition {
      condition     = data.discord_current_application.starlight_prod[0].id == local.discord_bots["starlight-prod"].expected_application_id
      error_message = "Discord token for starlight-prod resolved to an unexpected application ID; refusing to manage it."
    }
  }
}

resource "discord_application_settings" "scout_beta" {
  count    = contains(keys(local.discord_bots), "scout-beta") ? 1 : 0
  provider = discord.scout_beta

  description                       = try(local.discord_bots["scout-beta"].settings.description, null)
  custom_install_url                = try(local.discord_bots["scout-beta"].settings.custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["scout-beta"].settings.interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["scout-beta"].settings.role_connections_verification_url, null)
  tags                              = try(local.discord_bots["scout-beta"].settings.tags, [])

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = local.discord_bots["scout-beta"].expected_application_id != null
      error_message = "Discord bot scout-beta has no entry in bot-registry.json; add it there before managing it."
    }
    precondition {
      condition     = data.discord_current_application.scout_beta[0].id == local.discord_bots["scout-beta"].expected_application_id
      error_message = "Discord token for scout-beta resolved to an unexpected application ID; refusing to manage it."
    }
  }
}

resource "discord_application_settings" "scout_prod" {
  count    = contains(keys(local.discord_bots), "scout-prod") ? 1 : 0
  provider = discord.scout_prod

  description                       = try(local.discord_bots["scout-prod"].settings.description, null)
  custom_install_url                = try(local.discord_bots["scout-prod"].settings.custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["scout-prod"].settings.interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["scout-prod"].settings.role_connections_verification_url, null)
  tags                              = try(local.discord_bots["scout-prod"].settings.tags, [])

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = local.discord_bots["scout-prod"].expected_application_id != null
      error_message = "Discord bot scout-prod has no entry in bot-registry.json; add it there before managing it."
    }
    precondition {
      condition     = data.discord_current_application.scout_prod[0].id == local.discord_bots["scout-prod"].expected_application_id
      error_message = "Discord token for scout-prod resolved to an unexpected application ID; refusing to manage it."
    }
  }
}

resource "discord_application_settings" "minecraft" {
  count    = contains(keys(local.discord_bots), "minecraft") ? 1 : 0
  provider = discord.minecraft

  description                       = try(local.discord_bots["minecraft"].settings.description, null)
  custom_install_url                = try(local.discord_bots["minecraft"].settings.custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["minecraft"].settings.interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["minecraft"].settings.role_connections_verification_url, null)
  tags                              = try(local.discord_bots["minecraft"].settings.tags, [])

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = local.discord_bots["minecraft"].expected_application_id != null
      error_message = "Discord bot minecraft has no entry in bot-registry.json; add it there before managing it."
    }
    precondition {
      condition     = data.discord_current_application.minecraft[0].id == local.discord_bots["minecraft"].expected_application_id
      error_message = "Discord token for minecraft resolved to an unexpected application ID; refusing to manage it."
    }
  }
}

import {
  for_each = toset(contains(keys(local.discord_bots), "birmel") ? ["birmel"] : [])
  to       = discord_application_settings.birmel[0]
  id       = "self"
}

import {
  for_each = toset(contains(keys(local.discord_bots), "starlight-beta") ? ["starlight-beta"] : [])
  to       = discord_application_settings.starlight_beta[0]
  id       = "self"
}

import {
  for_each = toset(contains(keys(local.discord_bots), "starlight-prod") ? ["starlight-prod"] : [])
  to       = discord_application_settings.starlight_prod[0]
  id       = "self"
}

import {
  for_each = toset(contains(keys(local.discord_bots), "scout-beta") ? ["scout-beta"] : [])
  to       = discord_application_settings.scout_beta[0]
  id       = "self"
}

import {
  for_each = toset(contains(keys(local.discord_bots), "scout-prod") ? ["scout-prod"] : [])
  to       = discord_application_settings.scout_prod[0]
  id       = "self"
}

import {
  for_each = toset(contains(keys(local.discord_bots), "minecraft") ? ["minecraft"] : [])
  to       = discord_application_settings.minecraft[0]
  id       = "self"
}

moved {
  from = discord_application_settings.managed["birmel"]
  to   = discord_application_settings.birmel[0]
}

moved {
  from = discord_application_settings.managed["starlight-beta"]
  to   = discord_application_settings.starlight_beta[0]
}

moved {
  from = discord_application_settings.managed["starlight-prod"]
  to   = discord_application_settings.starlight_prod[0]
}

moved {
  from = discord_application_settings.managed["scout-beta"]
  to   = discord_application_settings.scout_beta[0]
}

moved {
  from = discord_application_settings.managed["scout-prod"]
  to   = discord_application_settings.scout_prod[0]
}

moved {
  from = discord_application_settings.managed["minecraft"]
  to   = discord_application_settings.minecraft[0]
}

output "discord_application_ids" {
  description = "Application snowflakes discovered from each configured bot token"
  value = {
    birmel         = try(data.discord_current_application.birmel[0].id, null)
    starlight_beta = try(data.discord_current_application.starlight_beta[0].id, null)
    starlight_prod = try(data.discord_current_application.starlight_prod[0].id, null)
    scout_beta     = try(data.discord_current_application.scout_beta[0].id, null)
    scout_prod     = try(data.discord_current_application.scout_prod[0].id, null)
    minecraft      = try(data.discord_current_application.minecraft[0].id, null)
  }
}
