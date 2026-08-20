terraform {
  required_version = ">= 1.9.0"

  required_providers {
    discord = {
      source  = "registry.terraform.io/alpaca744/discord"
      version = "~> 0.1.3"
    }
  }
}

provider "discord" {
  alias     = "birmel"
  bot_token = lookup(var.discord_bot_tokens, "birmel", null)
}

provider "discord" {
  alias     = "starlight_beta"
  bot_token = lookup(var.discord_bot_tokens, "starlight-beta", null)
}

provider "discord" {
  alias     = "starlight_prod"
  bot_token = lookup(var.discord_bot_tokens, "starlight-prod", null)
}

provider "discord" {
  alias     = "scout_beta"
  bot_token = lookup(var.discord_bot_tokens, "scout-beta", null)
}

provider "discord" {
  alias     = "scout_prod"
  bot_token = lookup(var.discord_bot_tokens, "scout-prod", null)
}

provider "discord" {
  alias     = "minecraft"
  bot_token = lookup(var.discord_bot_tokens, "minecraft", null)
}
