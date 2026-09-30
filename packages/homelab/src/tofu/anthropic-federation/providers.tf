terraform {
  required_version = ">= 1.9.0"

  required_providers {
    anthropic = {
      source  = "registry.terraform.io/ippontech/anthropic"
      version = "1.43.5"
    }
    onepassword = {
      source  = "1Password/onepassword"
      version = "~> 3.0"
    }
  }
}

# Workload identity federation is administered only with a short-lived
# `org:admin` OAuth token (ANTHROPIC_AUTH_TOKEN); the Admin API key that the
# `anthropic` stack uses is rejected by these endpoints, for reads as well as
# writes. That token has to be minted interactively, which is why this stack is
# operator-applied and never planned in CI. Workspaces still authenticate with
# ANTHROPIC_ADMIN_API_KEY, so a run needs both.
provider "anthropic" {}

# Writes each workload's identifiers into its own 1Password item, through the
# 1Password desktop app for the account named by OP_ACCOUNT.
provider "onepassword" {}
