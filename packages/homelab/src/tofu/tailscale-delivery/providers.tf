terraform {
  required_version = ">= 1.12.0"

  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "0.29.2"
    }
    onepassword = {
      source  = "1Password/onepassword"
      version = "~> 3.0"
    }
  }
}

# Operator-only credentials must be able to manage OAuth clients. The ACL-only
# client of the tailscale CI stack cannot provision these credentials.
provider "tailscale" {
  tailnet = var.tailscale_tailnet
}

# The operator wrapper supplies OP_SERVICE_ACCOUNT_TOKEN with vault-write access.
# CI and the in-cluster Connect identity never receive this capability.
provider "onepassword" {}
