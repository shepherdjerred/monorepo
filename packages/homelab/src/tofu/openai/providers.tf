terraform {
  required_version = ">= 1.9.0"

  required_providers {
    openai = {
      source  = "openai/openai"
      version = "~> 1.1"
    }
    openaikeys = {
      source  = "jianyuan/openai"
      version = "~> 0.7"
    }
    onepassword = {
      source  = "1Password/onepassword"
      version = "~> 3.3"
    }
  }
}

provider "openai" {
  admin_api_key = var.openai_admin_key
}

provider "openaikeys" {
  admin_key = var.openai_admin_key
}

provider "onepassword" {
  url = var.op_connect_url
}
