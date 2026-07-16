terraform {
  required_version = ">= 1.6.0"

  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.17"
    }
  }
}

provider "tailscale" {
  # OAuth client credentials are read from the environment:
  #   TAILSCALE_OAUTH_CLIENT_ID / TAILSCALE_OAUTH_CLIENT_SECRET
  # Create an OAuth client in the admin console (Settings > OAuth clients) with
  # the `acl` scope (write). Inject them via `op run`.
  tailnet = var.tailscale_tailnet
}
