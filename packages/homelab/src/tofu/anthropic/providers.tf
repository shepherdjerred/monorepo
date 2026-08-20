terraform {
  required_version = ">= 1.9.0"

  required_providers {
    anthropic = {
      source  = "registry.terraform.io/terraform-mars/anthropic"
      version = "~> 0.3.0"
    }
    onepassword = {
      source  = "1Password/onepassword"
      version = "~> 3.3"
    }
  }
}

provider "anthropic" {
  admin_key = var.anthropic_admin_key
}

provider "onepassword" {
  url = var.op_connect_url
}
