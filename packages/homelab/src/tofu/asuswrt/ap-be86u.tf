# RT-BE86U @ 192.168.1.2 (access point, sw_mode=3).
#
# Wireless is intentionally NOT managed here yet. On this device wl0/wl1 read
# back as a 32-hex, hidden (closed=1) SSID with crypto aes+gcmp256 — the
# signature of a former-AiMesh backhaul interface, NOT the real "Jerred"
# fronthaul (which likely lives on a virtual interface such as wl0.1). Managing
# wl0/wl1 as-is would manage the backhaul. Resolve the real fronthaul indices
# before adding wireless resources here (see todo: asuswrt-be86u-wireless).

resource "asuswrt_system" "be86u" {
  provider = asuswrt.ap_be86u

  hostname     = "RT-BE86U-9E90" # NVRAM lan_hostname
  timezone     = "PST8DST"
  ntp_server_0 = "pool.ntp.org"
  ntp_server_1 = "time.nist.gov"
}
