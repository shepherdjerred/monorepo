terraform {
  required_version = ">= 1.9.0"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.12"
    }
  }
}

provider "github" {
  owner = "shepherdjerred"
  token = var.github_token
}
