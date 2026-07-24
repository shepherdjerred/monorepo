# RT-AX88U @ 192.168.1.213 (access point, sw_mode=3).
# In AP mode DHCP-server / WAN / port-forward are inert, so only system and
# wireless are managed here.

resource "asuswrt_system" "ax88u" {
  provider = asuswrt.ap_ax88u

  # ntp_server1 is empty on this device, so it is omitted.
  hostname     = "RT-AX88U-9BA0" # NVRAM lan_hostname
  timezone     = "PST8DST"
  ntp_server_0 = "pool.ntp.org"
}

resource "asuswrt_wireless_network" "ax88u_wl0" {
  provider  = asuswrt.ap_ax88u
  band      = 0
  ssid      = "Jerred"
  auth_mode = "psk2"
  crypto    = "aes"
  channel   = 0 # auto
  bandwidth = 0 # auto
  hidden    = false
}

resource "asuswrt_wireless_network" "ax88u_wl1" {
  provider  = asuswrt.ap_ax88u
  band      = 1
  ssid      = "Jerred"
  auth_mode = "psk2"
  crypto    = "aes"
  channel   = 0
  bandwidth = 0
  hidden    = false
}
