terraform {
  required_version = ">= 1.6.0"

  required_providers {
    radarr = {
      source  = "devopsarr/radarr"
      version = "~> 2.0"
    }
    sonarr = {
      source  = "devopsarr/sonarr"
      version = "~> 3.0"
    }
    prowlarr = {
      source  = "devopsarr/prowlarr"
      version = "~> 3.0"
    }
  }
}

# *arr apps are reached over the tailnet (the CI Tofu container has tailnet
# access via the Talos node's tailscale extension, same as the S3 state
# backend). API keys come from the arr_api_keys JSON object, decoded into
# local.arr_api_keys (see locals.tf / variables.tf).
provider "radarr" {
  url     = "https://radarr.tailnet-1a49.ts.net"
  api_key = local.arr_api_keys["radarr"]
}

provider "sonarr" {
  url     = "https://sonarr.tailnet-1a49.ts.net"
  api_key = local.arr_api_keys["sonarr"]
}

provider "prowlarr" {
  url     = "https://prowlarr.tailnet-1a49.ts.net"
  api_key = local.arr_api_keys["prowlarr"]
}
