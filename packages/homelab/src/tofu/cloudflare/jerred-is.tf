resource "cloudflare_zone" "jerred_is" {
  account = { id = var.cloudflare_account_id }
  name    = "jerred.is"
}

# Redirect to sjer.red
resource "cloudflare_dns_record" "jerred_is_cname_apex" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "jerred.is"
  type    = "CNAME"
  content = "sjer.red"
  proxied = true
}

resource "cloudflare_dns_record" "jerred_is_cname_www" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "www"
  type    = "CNAME"
  content = "sjer.red"
  proxied = true
}

# Email security
resource "cloudflare_dns_record" "jerred_is_spf" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "jerred.is"
  type    = "TXT"
  content = "v=spf1 -all"
}

resource "cloudflare_dns_record" "jerred_is_dmarc" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc@sjer.red"
}

resource "cloudflare_dns_record" "jerred_is_dkim_wildcard" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "*._domainkey"
  type    = "TXT"
  content = "v=DKIM1; p="
}

# DNSSEC (pending — .is TLD requires manual DS record at registrar)
resource "cloudflare_zone_dnssec" "jerred_is" {
  zone_id = cloudflare_zone.jerred_is.id
}

# ── CAA: authorize CAs Cloudflare may use to issue certs for this zone ─────
resource "cloudflare_dns_record" "jerred_is_caa_issue_letsencrypt" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "jerred.is"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "letsencrypt.org"
  }
}

resource "cloudflare_dns_record" "jerred_is_caa_issue_google_trust_services" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "jerred.is"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "pki.goog; cansignhttpexchanges=yes"
  }
}

resource "cloudflare_dns_record" "jerred_is_caa_issue_sectigo" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "jerred.is"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "sectigo.com"
  }
}

resource "cloudflare_dns_record" "jerred_is_caa_issue_ssl_com" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "jerred.is"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "ssl.com"
  }
}

resource "cloudflare_dns_record" "jerred_is_caa_issuewild_none" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "jerred.is"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issuewild"
    value = ";"
  }
}

resource "cloudflare_dns_record" "jerred_is_caa_iodef" {
  zone_id = cloudflare_zone.jerred_is.id
  ttl     = 1
  name    = "jerred.is"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "iodef"
    value = "mailto:dmarc@sjer.red"
  }
}

# ── Edge hardening: min TLS 1.2 + HSTS (1-day rollback window) ──────────────
resource "cloudflare_zone_setting" "jerred_is_min_tls_version" {
  zone_id    = cloudflare_zone.jerred_is.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "jerred_is_security_header" {
  zone_id    = cloudflare_zone.jerred_is.id
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
