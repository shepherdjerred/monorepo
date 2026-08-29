locals {
  discord_bots = var.discord_bots
}

data "discord_current_application" "birmel" {
  provider = discord.birmel
}

data "discord_current_application" "starlight_beta" {
  provider = discord.starlight_beta
}

data "discord_current_application" "starlight_prod" {
  provider = discord.starlight_prod
}

data "discord_current_application" "scout_beta" {
  provider = discord.scout_beta
}

data "discord_current_application" "scout_prod" {
  provider = discord.scout_prod
}

data "discord_current_application" "minecraft" {
  provider = discord.minecraft
}

resource "discord_application_settings" "birmel" {
  provider                          = discord.birmel
  description                       = try(local.discord_bots["birmel"].description, null)
  custom_install_url                = try(local.discord_bots["birmel"].custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["birmel"].interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["birmel"].role_connections_verification_url, null)
  tags                              = local.discord_bots["birmel"].tags
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = data.discord_current_application.birmel.id == local.discord_bots["birmel"].expected_application_id
      error_message = "The birmel token resolved to an unexpected Discord application ID."
    }
  }
}

resource "discord_application_settings" "starlight_beta" {
  provider                          = discord.starlight_beta
  description                       = try(local.discord_bots["starlight-beta"].description, null)
  custom_install_url                = try(local.discord_bots["starlight-beta"].custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["starlight-beta"].interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["starlight-beta"].role_connections_verification_url, null)
  tags                              = local.discord_bots["starlight-beta"].tags
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = data.discord_current_application.starlight_beta.id == local.discord_bots["starlight-beta"].expected_application_id
      error_message = "The starlight-beta token resolved to an unexpected Discord application ID."
    }
  }
}

resource "discord_application_settings" "starlight_prod" {
  provider                          = discord.starlight_prod
  description                       = try(local.discord_bots["starlight-prod"].description, null)
  custom_install_url                = try(local.discord_bots["starlight-prod"].custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["starlight-prod"].interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["starlight-prod"].role_connections_verification_url, null)
  tags                              = local.discord_bots["starlight-prod"].tags
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = data.discord_current_application.starlight_prod.id == local.discord_bots["starlight-prod"].expected_application_id
      error_message = "The starlight-prod token resolved to an unexpected Discord application ID."
    }
  }
}

resource "discord_application_settings" "scout_beta" {
  provider                          = discord.scout_beta
  description                       = try(local.discord_bots["scout-beta"].description, null)
  custom_install_url                = try(local.discord_bots["scout-beta"].custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["scout-beta"].interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["scout-beta"].role_connections_verification_url, null)
  tags                              = local.discord_bots["scout-beta"].tags
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = data.discord_current_application.scout_beta.id == local.discord_bots["scout-beta"].expected_application_id
      error_message = "The scout-beta token resolved to an unexpected Discord application ID."
    }
  }
}

resource "discord_application_settings" "scout_prod" {
  provider                          = discord.scout_prod
  description                       = try(local.discord_bots["scout-prod"].description, null)
  custom_install_url                = try(local.discord_bots["scout-prod"].custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["scout-prod"].interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["scout-prod"].role_connections_verification_url, null)
  tags                              = local.discord_bots["scout-prod"].tags
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = data.discord_current_application.scout_prod.id == local.discord_bots["scout-prod"].expected_application_id
      error_message = "The scout-prod token resolved to an unexpected Discord application ID."
    }
  }
}

resource "discord_application_settings" "minecraft" {
  provider                          = discord.minecraft
  description                       = try(local.discord_bots["minecraft"].description, null)
  custom_install_url                = try(local.discord_bots["minecraft"].custom_install_url, null)
  interactions_endpoint_url         = try(local.discord_bots["minecraft"].interactions_endpoint_url, null)
  role_connections_verification_url = try(local.discord_bots["minecraft"].role_connections_verification_url, null)
  tags                              = local.discord_bots["minecraft"].tags
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = data.discord_current_application.minecraft.id == local.discord_bots["minecraft"].expected_application_id
      error_message = "The minecraft token resolved to an unexpected Discord application ID."
    }
  }
}

import {
  to = discord_application_settings.birmel
  id = "self"
}

import {
  to = discord_application_settings.starlight_beta
  id = "self"
}

import {
  to = discord_application_settings.starlight_prod
  id = "self"
}

import {
  to = discord_application_settings.scout_beta
  id = "self"
}

import {
  to = discord_application_settings.scout_prod
  id = "self"
}

import {
  to = discord_application_settings.minecraft
  id = "self"
}

output "discord_application_ids" {
  description = "Application IDs verified from each configured bot token"
  value = {
    birmel         = data.discord_current_application.birmel.id
    starlight_beta = data.discord_current_application.starlight_beta.id
    starlight_prod = data.discord_current_application.starlight_prod.id
    scout_beta     = data.discord_current_application.scout_beta.id
    scout_prod     = data.discord_current_application.scout_prod.id
    minecraft      = data.discord_current_application.minecraft.id
  }
}
