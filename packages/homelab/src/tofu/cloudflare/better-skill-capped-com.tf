resource "cloudflare_zone" "better_skill_capped_com" {
  account_id = var.cloudflare_account_id
  zone       = "better-skill-capped.com"
}

# Apex CNAME to Cloudflare Tunnel
resource "cloudflare_record" "better_skill_capped_com_cname_apex" {
  zone_id = cloudflare_zone.better_skill_capped_com.id
  name    = "better-skill-capped.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Email security
resource "cloudflare_record" "better_skill_capped_com_spf" {
  zone_id = cloudflare_zone.better_skill_capped_com.id
  name    = "better-skill-capped.com"
  type    = "TXT"
  content = "v=spf1 -all"
}

resource "cloudflare_record" "better_skill_capped_com_dmarc" {
  zone_id = cloudflare_zone.better_skill_capped_com.id
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;"
}

resource "cloudflare_record" "better_skill_capped_com_dkim_wildcard" {
  zone_id = cloudflare_zone.better_skill_capped_com.id
  name    = "*._domainkey"
  type    = "TXT"
  content = "v=DKIM1; p="
}

# DNSSEC
resource "cloudflare_zone_dnssec" "better_skill_capped_com" {
  zone_id = cloudflare_zone.better_skill_capped_com.id
}
