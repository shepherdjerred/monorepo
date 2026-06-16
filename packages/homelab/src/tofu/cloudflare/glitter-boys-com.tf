resource "cloudflare_zone" "glitter_boys_com" {
  account = { id = var.cloudflare_account_id }
  name    = "glitter-boys.com"
}

# Fly.io app CNAMEs
resource "cloudflare_dns_record" "glitter_boys_com_cname_beta" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "beta"
  type    = "CNAME"
  content = "glitter-boys-beta.fly.dev"
  proxied = false
}

resource "cloudflare_dns_record" "glitter_boys_com_cname_prod" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "prod"
  type    = "CNAME"
  content = "glitter-boys-prod.fly.dev"
  proxied = false
}

# Homelab static site: Cloudflare Tunnel → s3-static-sites Caddy → glitter-boys-ppl bucket
resource "cloudflare_dns_record" "glitter_boys_com_cname_ppl" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "ppl"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Email security
resource "cloudflare_dns_record" "glitter_boys_com_spf" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "glitter-boys.com"
  type    = "TXT"
  content = "v=spf1 -all"
}

resource "cloudflare_dns_record" "glitter_boys_com_dmarc" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc@sjer.red"
}

resource "cloudflare_dns_record" "glitter_boys_com_dkim_wildcard" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "*._domainkey"
  type    = "TXT"
  content = "v=DKIM1; p="
}

# DNSSEC
resource "cloudflare_zone_dnssec" "glitter_boys_com" {
  zone_id = cloudflare_zone.glitter_boys_com.id
}

# ── CAA: authorize CAs Cloudflare may use to issue certs for this zone ─────
resource "cloudflare_dns_record" "glitter_boys_com_caa_issue_letsencrypt" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "glitter-boys.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "letsencrypt.org"
  }
}

resource "cloudflare_dns_record" "glitter_boys_com_caa_issue_google_trust_services" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "glitter-boys.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "pki.goog; cansignhttpexchanges=yes"
  }
}

resource "cloudflare_dns_record" "glitter_boys_com_caa_issue_sectigo" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "glitter-boys.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "sectigo.com"
  }
}

resource "cloudflare_dns_record" "glitter_boys_com_caa_issue_ssl_com" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "glitter-boys.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "ssl.com"
  }
}

resource "cloudflare_dns_record" "glitter_boys_com_caa_issuewild_none" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "glitter-boys.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issuewild"
    value = ";"
  }
}

resource "cloudflare_dns_record" "glitter_boys_com_caa_iodef" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "glitter-boys.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "iodef"
    value = "mailto:dmarc@sjer.red"
  }
}

# ── Edge hardening: min TLS 1.2 + HSTS (1-day rollback window) ──────────────
resource "cloudflare_zone_setting" "glitter_boys_com_min_tls_version" {
  zone_id    = cloudflare_zone.glitter_boys_com.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "glitter_boys_com_security_header" {
  zone_id    = cloudflare_zone.glitter_boys_com.id
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
