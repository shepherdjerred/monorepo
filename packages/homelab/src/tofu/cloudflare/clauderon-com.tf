resource "cloudflare_zone" "clauderon_com" {
  account = { id = var.cloudflare_account_id }
  name    = "clauderon.com"
}

# The archived site is retired. Cloudflare's edge serves the redirect before
# any origin fetch, so the discard address is never actually contacted.
resource "cloudflare_dns_record" "clauderon_com_apex" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "AAAA"
  content = "100::"
  proxied = true
}

resource "cloudflare_dns_record" "clauderon_com_www" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "www"
  type    = "AAAA"
  content = "100::"
  proxied = true
}

# Proxied IPv4 placeholders ensure IPv4-only clients can reach Cloudflare's
# edge and receive the redirect; the address is never contacted as an origin.
resource "cloudflare_dns_record" "clauderon_com_apex_ipv4" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "A"
  content = "192.0.2.1"
  proxied = true
}

resource "cloudflare_dns_record" "clauderon_com_www_ipv4" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "www"
  type    = "A"
  content = "192.0.2.1"
  proxied = true
}

resource "cloudflare_ruleset" "clauderon_com_redirect" {
  zone_id = cloudflare_zone.clauderon_com.id
  name    = "clauderon.com to sjer.red"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [{
    ref         = "clauderon_to_sjer_red"
    description = "Redirect the retired Clauderon site to sjer.red"
    expression  = "(http.host eq \"clauderon.com\" or http.host eq \"www.clauderon.com\")"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = true
        target_url = {
          value = "https://sjer.red"
        }
      }
    }
  }]
}

# Email security
resource "cloudflare_dns_record" "clauderon_com_spf" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "TXT"
  content = "v=spf1 -all"
}

resource "cloudflare_dns_record" "clauderon_com_dmarc" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc@sjer.red"
}

resource "cloudflare_dns_record" "clauderon_com_dkim_wildcard" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "*._domainkey"
  type    = "TXT"
  content = "v=DKIM1; p="
}

# DNSSEC
resource "cloudflare_zone_dnssec" "clauderon_com" {
  zone_id = cloudflare_zone.clauderon_com.id
}

# ── CAA: authorize CAs Cloudflare may use to issue certs for this zone ─────
resource "cloudflare_dns_record" "clauderon_com_caa_issue_letsencrypt" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "letsencrypt.org"
  }
}

resource "cloudflare_dns_record" "clauderon_com_caa_issue_google_trust_services" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "pki.goog; cansignhttpexchanges=yes"
  }
}

resource "cloudflare_dns_record" "clauderon_com_caa_issue_sectigo" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "sectigo.com"
  }
}

resource "cloudflare_dns_record" "clauderon_com_caa_issue_ssl_com" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "ssl.com"
  }
}

resource "cloudflare_dns_record" "clauderon_com_caa_issuewild_none" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issuewild"
    value = ";"
  }
}

resource "cloudflare_dns_record" "clauderon_com_caa_iodef" {
  zone_id = cloudflare_zone.clauderon_com.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "iodef"
    value = "mailto:dmarc@sjer.red"
  }
}

# ── Edge hardening: min TLS 1.2 + HSTS (1-day rollback window) ──────────────
resource "cloudflare_zone_setting" "clauderon_com_min_tls_version" {
  zone_id    = cloudflare_zone.clauderon_com.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "clauderon_com_security_header" {
  zone_id    = cloudflare_zone.clauderon_com.id
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
