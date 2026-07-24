terraform {
  required_version = ">= 1.6.0"

  required_providers {
    asuswrt = {
      # Custom provider built from packages/terraform-provider-asuswrt.
      # Not published to a registry: installed into the local filesystem mirror
      # via `make -C packages/terraform-provider-asuswrt install` (see README).
      source  = "shepherdjerred/asuswrt"
      version = "0.1.0"
    }
  }
}

# One aliased provider per device. All three share the same credentials and are
# reachable only on the LAN (see README: this stack is local-run only).
provider "asuswrt" {
  alias    = "router"
  host     = "192.168.1.1"
  port     = 8443
  https    = true
  insecure = true # self-signed router certificate
  username = var.asuswrt_username
  password = var.asuswrt_password
}

provider "asuswrt" {
  alias    = "ap_be86u"
  host     = "192.168.1.2"
  port     = 8443
  https    = true
  insecure = true
  username = var.asuswrt_username
  password = var.asuswrt_password
}

provider "asuswrt" {
  alias    = "ap_ax88u"
  host     = "192.168.1.213"
  port     = 8443
  https    = true
  insecure = true
  username = var.asuswrt_username
  password = var.asuswrt_password
}
