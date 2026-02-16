resource "cloudflare_zone" "scout_for_lol_com" {
  account_id = var.cloudflare_account_id
  zone       = "scout-for-lol.com"
}

# Apex CNAME to Cloudflare Tunnel
resource "cloudflare_record" "scout_for_lol_com_cname_apex" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  name    = "scout-for-lol.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Email security
resource "cloudflare_record" "scout_for_lol_com_spf" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  name    = "scout-for-lol.com"
  type    = "TXT"
  content = "v=spf1 -all"
}

resource "cloudflare_record" "scout_for_lol_com_dmarc" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;"
}

resource "cloudflare_record" "scout_for_lol_com_dkim_wildcard" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  name    = "*._domainkey"
  type    = "TXT"
  content = "v=DKIM1; p="
}

# DNSSEC
resource "cloudflare_zone_dnssec" "scout_for_lol_com" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
}
