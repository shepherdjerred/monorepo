terraform {
  required_version = ">= 1.11.0"

  required_providers {
    openrouter = {
      source  = "registry.terraform.io/OpenRouterTeam/openrouter"
      version = "0.3.19"
    }
  }
}

provider "openrouter" {
  # Authenticated through OPENROUTER_MANAGEMENT_KEY.
}
