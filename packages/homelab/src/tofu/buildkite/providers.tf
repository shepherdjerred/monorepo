terraform {
  required_version = ">= 1.6.0"

  required_providers {
    buildkite = {
      source  = "buildkite/buildkite"
      version = "~> 1.0"
    }
  }
}

provider "buildkite" {
  organization = "sjerred"
  api_token    = var.buildkite_api_token
}
