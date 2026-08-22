terraform {
  required_version = ">= 1.9.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.22"
    }
    onepassword = {
      source  = "1Password/onepassword"
      version = "~> 3.3"
    }
  }
}

provider "cloudflare" {
  # Authenticated via CLOUDFLARE_API_TOKEN environment variable
}

provider "onepassword" {
  url = var.op_connect_url
}
