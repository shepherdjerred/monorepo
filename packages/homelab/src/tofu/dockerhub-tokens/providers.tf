terraform {
  required_version = ">= 1.11.0"

  required_providers {
    docker = {
      source  = "docker/docker"
      version = "0.7.0"
    }
  }
}

provider "docker" {
  # Operator-only: use injected account credentials or the native account login.
  # A PAT can manage repositories but cannot create or manage other PATs.
}
