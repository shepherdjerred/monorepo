terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.27.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
  }
}

provider "cloudflare" {
  # Authenticated via CLOUDFLARE_API_TOKEN environment variable
}
