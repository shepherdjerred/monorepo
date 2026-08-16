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
  # Authenticated through OPENAI_ADMIN_KEY.
}

provider "openaikeys" {
  # The companion provider is used only for the service-account API key
  # returned by its service-account resource; organization controls remain on
  # the official provider above.
}

provider "onepassword" {
  url = var.op_connect_url
}
