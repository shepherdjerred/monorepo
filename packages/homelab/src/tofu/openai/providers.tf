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
  }
}

provider "openai" {
  # The official provider reads OPENAI_API_KEY; the wrapper maps that name from
  # the dedicated OPENAI_ADMIN_KEY 1Password field.
}

provider "openaikeys" {
  # The companion provider also reads OPENAI_API_KEY and is used only for the
  # service-account API key returned by its service-account resource;
  # organization controls remain on the official provider above.
}
