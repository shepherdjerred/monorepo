terraform {
  required_version = ">= 1.9.0"

  required_providers {
    openrouterbyok = {
      source  = "shepherdjerred/openrouter-byok"
      version = "~> 0.1"
    }
    openrouter = {
      source  = "cloudopsworks/openrouter"
      version = "~> 0.3.0"
    }
    onepassword = {
      source  = "1Password/onepassword"
      version = "~> 3.3"
    }
  }
}

provider "openrouter" {
  # Authenticated through OPENROUTER_API_KEY, which must be a management key.
}

provider "openrouterbyok" {}

provider "onepassword" {
  url = var.op_connect_url
}
