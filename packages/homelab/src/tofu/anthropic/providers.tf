terraform {
  required_version = ">= 1.9.0"

  required_providers {
    anthropic = {
      source  = "registry.terraform.io/ippontech/anthropic"
      version = "1.28.1"
    }
  }
}

provider "anthropic" {
  # Authenticated through ANTHROPIC_ADMIN_API_KEY.
}
