resource "cloudflare_zone" "ts_mc_net" {
  account = { id = var.cloudflare_account_id }
  name    = "ts-mc.net"
}

# ── A records ───────────────────────────────────────────────────────────────

resource "cloudflare_dns_record" "ts_mc_net_cname_minecraft" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "minecraft"
  type    = "CNAME"
  content = "ddns.sjer.red"
  proxied = false
}

# ── CNAMEs ──────────────────────────────────────────────────────────────────

resource "cloudflare_dns_record" "ts_mc_net_cname_apex" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "ts-mc.net"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "ts_mc_net_cname_bluemap" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "bluemap"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# storage.ts-mc.net CNAME is auto-managed by Cloudflare R2 custom domain

# FastMail DKIM
resource "cloudflare_dns_record" "ts_mc_net_dkim_fm1" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "fm1._domainkey"
  type    = "CNAME"
  content = "fm1.ts-mc.net.dkim.fmhosted.com"
  proxied = false
}

resource "cloudflare_dns_record" "ts_mc_net_dkim_fm2" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "fm2._domainkey"
  type    = "CNAME"
  content = "fm2.ts-mc.net.dkim.fmhosted.com"
  proxied = false
}

resource "cloudflare_dns_record" "ts_mc_net_dkim_fm3" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "fm3._domainkey"
  type    = "CNAME"
  content = "fm3.ts-mc.net.dkim.fmhosted.com"
  proxied = false
}

# ── MX (FastMail) ───────────────────────────────────────────────────────────

resource "cloudflare_dns_record" "ts_mc_net_mx1" {
  zone_id  = cloudflare_zone.ts_mc_net.id
  ttl      = 1
  name     = "ts-mc.net"
  type     = "MX"
  content  = "in1-smtp.messagingengine.com"
  priority = 10
}

resource "cloudflare_dns_record" "ts_mc_net_mx2" {
  zone_id  = cloudflare_zone.ts_mc_net.id
  ttl      = 1
  name     = "ts-mc.net"
  type     = "MX"
  content  = "in2-smtp.messagingengine.com"
  priority = 20
}

resource "cloudflare_dns_record" "ts_mc_net_mx_wildcard1" {
  zone_id  = cloudflare_zone.ts_mc_net.id
  ttl      = 1
  name     = "*"
  type     = "MX"
  content  = "in1-smtp.messagingengine.com"
  priority = 10
}

resource "cloudflare_dns_record" "ts_mc_net_mx_wildcard2" {
  zone_id  = cloudflare_zone.ts_mc_net.id
  ttl      = 1
  name     = "*"
  type     = "MX"
  content  = "in2-smtp.messagingengine.com"
  priority = 20
}

# ── SRV ─────────────────────────────────────────────────────────────────────

resource "cloudflare_dns_record" "ts_mc_net_srv_minecraft" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "_minecraft._tcp"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "mc.ts-mc.net"
  }
}

# ── TXT ─────────────────────────────────────────────────────────────────────

resource "cloudflare_dns_record" "ts_mc_net_spf" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "ts-mc.net"
  type    = "TXT"
  content = "v=spf1 include:spf.messagingengine.com ~all"
}

resource "cloudflare_dns_record" "ts_mc_net_dmarc" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:dmarc@sjer.red"
}

# DNSSEC
resource "cloudflare_zone_dnssec" "ts_mc_net" {
  zone_id = cloudflare_zone.ts_mc_net.id
}

# ── CAA: authorize CAs Cloudflare may use to issue certs for this zone ─────
resource "cloudflare_dns_record" "ts_mc_net_caa_issue_letsencrypt" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "ts-mc.net"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "letsencrypt.org"
  }
}

resource "cloudflare_dns_record" "ts_mc_net_caa_issue_google_trust_services" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "ts-mc.net"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "pki.goog; cansignhttpexchanges=yes"
  }
}

resource "cloudflare_dns_record" "ts_mc_net_caa_issue_sectigo" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "ts-mc.net"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "sectigo.com"
  }
}

resource "cloudflare_dns_record" "ts_mc_net_caa_issue_ssl_com" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "ts-mc.net"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "ssl.com"
  }
}

resource "cloudflare_dns_record" "ts_mc_net_caa_issuewild_none" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "ts-mc.net"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issuewild"
    value = ";"
  }
}

resource "cloudflare_dns_record" "ts_mc_net_caa_iodef" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "ts-mc.net"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "iodef"
    value = "mailto:dmarc@sjer.red"
  }
}

# ── Edge hardening: min TLS 1.2 + HSTS (1-day rollback window) ──────────────
resource "cloudflare_zone_setting" "ts_mc_net_min_tls_version" {
  zone_id    = cloudflare_zone.ts_mc_net.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "ts_mc_net_security_header" {
  zone_id    = cloudflare_zone.ts_mc_net.id
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

# ── TLSRPT: ask senders to report STARTTLS failures ─────────────────────────
resource "cloudflare_dns_record" "ts_mc_net_tlsrpt" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "_smtp._tls"
  type    = "TXT"
  content = "v=TLSRPTv1; rua=mailto:dmarc@sjer.red"
}
