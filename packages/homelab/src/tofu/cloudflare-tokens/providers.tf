terraform {
  required_version = ">= 1.11.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.24.0"
    }
  }
}

provider "cloudflare" {
  # Authenticated through the narrowly scoped CLOUDFLARE_API_TOKEN bootstrap key.
}
