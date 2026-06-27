resource "cloudflare_zone" "scout_for_lol_com" {
  account = { id = var.cloudflare_account_id }
  name    = "scout-for-lol.com"
}

# Apex CNAME to Cloudflare Tunnel
resource "cloudflare_dns_record" "scout_for_lol_com_cname_apex" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "scout-for-lol.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "scout_for_lol_com_cname_beta" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "beta"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Email security
resource "cloudflare_dns_record" "scout_for_lol_com_spf" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "scout-for-lol.com"
  type    = "TXT"
  content = "v=spf1 -all"
}

resource "cloudflare_dns_record" "scout_for_lol_com_dmarc" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc@sjer.red"
}

resource "cloudflare_dns_record" "scout_for_lol_com_dkim_wildcard" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "*._domainkey"
  type    = "TXT"
  content = "v=DKIM1; p="
}

# DNSSEC
resource "cloudflare_zone_dnssec" "scout_for_lol_com" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
}

# ── CAA: authorize CAs Cloudflare may use to issue certs for this zone ─────
resource "cloudflare_dns_record" "scout_for_lol_com_caa_issue_letsencrypt" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "scout-for-lol.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "letsencrypt.org"
  }
}

resource "cloudflare_dns_record" "scout_for_lol_com_caa_issue_google_trust_services" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "scout-for-lol.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "pki.goog; cansignhttpexchanges=yes"
  }
}

resource "cloudflare_dns_record" "scout_for_lol_com_caa_issue_sectigo" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "scout-for-lol.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "sectigo.com"
  }
}

resource "cloudflare_dns_record" "scout_for_lol_com_caa_issue_ssl_com" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "scout-for-lol.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "ssl.com"
  }
}

resource "cloudflare_dns_record" "scout_for_lol_com_caa_issuewild_none" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "scout-for-lol.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issuewild"
    value = ";"
  }
}

resource "cloudflare_dns_record" "scout_for_lol_com_caa_iodef" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "scout-for-lol.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "iodef"
    value = "mailto:dmarc@sjer.red"
  }
}

# ── Edge hardening: min TLS 1.2 + HSTS (1-day rollback window) ──────────────
resource "cloudflare_zone_setting" "scout_for_lol_com_min_tls_version" {
  zone_id    = cloudflare_zone.scout_for_lol_com.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "scout_for_lol_com_security_header" {
  zone_id    = cloudflare_zone.scout_for_lol_com.id
  setting_id = "security_header"
  value = {
    strict_transport_security = {
      enabled            = true
      max_age            = 86400
      include_subdomains = true
      nosniff            = true
      preload            = false
    }
  }
}

# ── Static-asset caching: respect the immutable Cache-Control the deploy sets on
# content-hashed assets + Smart Tiered Cache (origin shielding). ───────────────
module "scout_for_lol_com_static_cache" {
  source         = "./modules/static-cache"
  zone_id        = cloudflare_zone.scout_for_lol_com.id
  asset_prefixes = ["/_astro/", "/app/assets/"]
}
