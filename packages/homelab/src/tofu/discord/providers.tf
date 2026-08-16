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
  alias     = "bot"
  for_each  = setunion(toset(keys(var.discord_bots)), var.discord_provider_names)
  bot_token = var.discord_bot_tokens[each.key]
}
