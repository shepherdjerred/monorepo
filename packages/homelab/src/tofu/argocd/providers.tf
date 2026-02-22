terraform {
  required_version = ">= 1.6.0"

  required_providers {
    argocd = {
      source  = "argoproj-labs/argocd"
      version = "~> 7.0"
    }
    onepassword = {
      source  = "1Password/onepassword"
      version = "~> 2.0"
    }
  }
}

provider "argocd" {
  server_addr = "argocd.tailnet-1a49.ts.net:443"
  username    = "admin"
  password    = var.argocd_admin_password
}

provider "onepassword" {
  # Authenticated via OP_SERVICE_ACCOUNT_TOKEN env var
}
