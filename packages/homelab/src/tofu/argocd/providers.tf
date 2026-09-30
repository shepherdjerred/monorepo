terraform {
  required_version = ">= 1.6.0"

  required_providers {
    argocd = {
      source  = "argoproj-labs/argocd"
      version = "~> 7.0"
    }
    onepassword = {
      source  = "1Password/onepassword"
      version = "~> 3.0"
    }
  }
}

provider "argocd" {
  server_addr = "argocd.tailnet-1a49.ts.net:443"
  auth_token  = var.argocd_auth_token
}

provider "onepassword" {
  # The operator-run wrapper supplies a vault-scoped service account through
  # OP_SERVICE_ACCOUNT_TOKEN. The in-cluster Connect token is read-only.
}
