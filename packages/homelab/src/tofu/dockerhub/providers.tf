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
  # DOCKER_USERNAME and DOCKER_PASSWORD are isolated by the stack wrapper.
}
