terraform {
  required_version = ">= 1.11.0"

  required_providers {
    discord = {
      source  = "registry.terraform.io/alpaca744/discord"
      version = "0.1.3"
    }
  }
}

provider "discord" {
  alias     = "birmel"
  bot_token = var.discord_bot_tokens["birmel"]
}

provider "discord" {
  alias     = "starlight_beta"
  bot_token = var.discord_bot_tokens["starlight-beta"]
}

provider "discord" {
  alias     = "starlight_prod"
  bot_token = var.discord_bot_tokens["starlight-prod"]
}

provider "discord" {
  alias     = "scout_beta"
  bot_token = var.discord_bot_tokens["scout-beta"]
}

provider "discord" {
  alias     = "scout_prod"
  bot_token = var.discord_bot_tokens["scout-prod"]
}

provider "discord" {
  alias     = "minecraft"
  bot_token = var.discord_bot_tokens["minecraft"]
}
