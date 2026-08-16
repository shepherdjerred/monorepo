# RT-AX88U Pro @ 192.168.1.1 (main router, sw_mode=1).
# All values mirror the live device; import produces a clean plan.

resource "asuswrt_system" "router" {
  provider = asuswrt.router

  hostname     = "RT-AX88U_Pro-74C0" # NVRAM lan_hostname
  timezone     = "PST8DST"
  ntp_server_0 = "pool.ntp.org"
  ntp_server_1 = "time.nist.gov"
}

# --- DHCP static leases ---
resource "asuswrt_dhcp_static_lease" "plex_host" {
  provider = asuswrt.router
  mac      = "08:BF:B8:D4:59:7F"
  ip       = "192.168.1.81"
}

resource "asuswrt_dhcp_static_lease" "lease_61" {
  provider = asuswrt.router
  mac      = "48:DA:35:6F:61:BF"
  ip       = "192.168.1.61"
}

resource "asuswrt_dhcp_static_lease" "lease_90" {
  provider = asuswrt.router
  mac      = "4C:B9:EA:97:90:5A"
  ip       = "192.168.1.90"
}

resource "asuswrt_dhcp_static_lease" "lease_43" {
  provider = asuswrt.router
  mac      = "50:26:EF:28:F1:DE"
  ip       = "192.168.1.43"
}

resource "asuswrt_dhcp_static_lease" "lease_173" {
  provider = asuswrt.router
  mac      = "50:26:EF:29:70:EE"
  ip       = "192.168.1.173"
}

# --- Port forwards ---
resource "asuswrt_port_forward" "plex" {
  provider      = asuswrt.router
  name          = "Plex"
  protocol      = "TCP"
  external_port = "32400"
  internal_ip   = "192.168.1.81"
  internal_port = "32400"
}

resource "asuswrt_port_forward" "minecraft_mc_router" {
  provider      = asuswrt.router
  name          = "Minecraft mc-router"
  protocol      = "TCP"
  external_port = "30000"
  internal_ip   = "192.168.1.81"
  internal_port = "30000"
}

# Note: the rule name is spelled "Mineraft Bedrock" on the device; kept verbatim
# so the identity matches (renaming would force replace).
resource "asuswrt_port_forward" "minecraft_bedrock" {
  provider      = asuswrt.router
  name          = "Mineraft Bedrock"
  protocol      = "UDP"
  external_port = "30003"
  internal_ip   = "192.168.1.81"
  internal_port = "30003"
}

# --- Wireless (wpa_passphrase intentionally omitted: write-only, would churn
# every plan/apply; manage the PSK out-of-band). ---
resource "asuswrt_wireless_network" "wl0" {
  provider  = asuswrt.router
  band      = 0
  ssid      = "Jerred"
  auth_mode = "psk2sae"
  crypto    = "aes"
  channel   = 6
  bandwidth = 1
  hidden    = false
}

resource "asuswrt_wireless_network" "wl1" {
  provider  = asuswrt.router
  band      = 1
  ssid      = "Jerred"
  auth_mode = "psk2sae"
  crypto    = "aes"
  channel   = 149
  bandwidth = 3
  hidden    = false
}
