terraform {
  required_providers {
    asuswrt = {
      source = "shepherdjerred/asuswrt"
    }
  }
}

provider "asuswrt" {
  host     = "192.168.1.1"
  username = "admin"
  password = var.router_password
}

variable "router_password" {
  type      = string
  sensitive = true
}

variable "wifi_password" {
  type      = string
  sensitive = true
}

resource "asuswrt_system" "router" {
  hostname     = "MyRouter"
  timezone     = "EST5EDT,M3.2.0,M11.1.0"
  ntp_server_0 = "pool.ntp.org"
  ntp_server_1 = "time.nist.gov"
}

resource "asuswrt_dhcp_static_lease" "server" {
  mac      = "AA:BB:CC:DD:EE:FF"
  ip       = "192.168.1.100"
  hostname = "homeserver"
}

resource "asuswrt_wireless_network" "wifi_5ghz" {
  band           = 1
  ssid           = "MyNetwork-5G"
  auth_mode      = "psk2sae"
  crypto         = "aes"
  wpa_passphrase = var.wifi_password
  channel        = 0
  bandwidth      = 4
  hidden         = false
}

resource "asuswrt_port_forward" "http" {
  name          = "HTTP"
  protocol      = "tcp"
  external_port = "80"
  internal_ip   = "192.168.1.100"
  internal_port = "80"
}

data "asuswrt_nvram" "firmware" {
  key = "firmver"
}

output "firmware_version" {
  value = data.asuswrt_nvram.firmware.value
}
