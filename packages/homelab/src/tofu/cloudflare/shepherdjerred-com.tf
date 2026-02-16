resource "cloudflare_zone" "shepherdjerred_com" {
  account_id = var.cloudflare_account_id
  zone       = "shepherdjerred.com"
}

# ── CNAMEs ──────────────────────────────────────────────────────────────────

# FastMail DKIM
resource "cloudflare_record" "shepherdjerred_com_dkim_fm1" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "fm1._domainkey"
  type    = "CNAME"
  content = "fm1.shepherdjerred.com.dkim.fmhosted.com"
  proxied = false
}

resource "cloudflare_record" "shepherdjerred_com_dkim_fm2" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "fm2._domainkey"
  type    = "CNAME"
  content = "fm2.shepherdjerred.com.dkim.fmhosted.com"
  proxied = false
}

resource "cloudflare_record" "shepherdjerred_com_dkim_fm3" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "fm3._domainkey"
  type    = "CNAME"
  content = "fm3.shepherdjerred.com.dkim.fmhosted.com"
  proxied = false
}

# Redirect to sjer.red
resource "cloudflare_record" "shepherdjerred_com_cname_apex" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "shepherdjerred.com"
  type    = "CNAME"
  content = "sjer.red"
  proxied = false
}

resource "cloudflare_record" "shepherdjerred_com_cname_www" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "www"
  type    = "CNAME"
  content = "sjer.red"
  proxied = false
}

# ── MX ──────────────────────────────────────────────────────────────────────

# FastMail MX (apex)
resource "cloudflare_record" "shepherdjerred_com_mx1" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  name     = "shepherdjerred.com"
  type     = "MX"
  content  = "in1-smtp.messagingengine.com"
  priority = 10
}

resource "cloudflare_record" "shepherdjerred_com_mx2" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  name     = "shepherdjerred.com"
  type     = "MX"
  content  = "in2-smtp.messagingengine.com"
  priority = 20
}

# FastMail MX (wildcard)
resource "cloudflare_record" "shepherdjerred_com_mx_wildcard1" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  name     = "*"
  type     = "MX"
  content  = "in1-smtp.messagingengine.com"
  priority = 10
}

resource "cloudflare_record" "shepherdjerred_com_mx_wildcard2" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  name     = "*"
  type     = "MX"
  content  = "in2-smtp.messagingengine.com"
  priority = 20
}

# ── SRV (FastMail autodiscovery) ────────────────────────────────────────────

resource "cloudflare_record" "shepherdjerred_com_srv_caldavs" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "_caldavs._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 1
    port     = 443
    target   = "caldav.fastmail.com"
  }
}

resource "cloudflare_record" "shepherdjerred_com_srv_caldav" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "_caldav._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_record" "shepherdjerred_com_srv_carddavs" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "_carddavs._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 1
    port     = 443
    target   = "carddav.fastmail.com"
  }
}

resource "cloudflare_record" "shepherdjerred_com_srv_carddav" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "_carddav._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_record" "shepherdjerred_com_srv_imaps" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "_imaps._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 1
    port     = 993
    target   = "imap.fastmail.com"
  }
}

resource "cloudflare_record" "shepherdjerred_com_srv_imap" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "_imap._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_record" "shepherdjerred_com_srv_pop3s" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "_pop3s._tcp"
  type    = "SRV"
  data {
    priority = 10
    weight   = 1
    port     = 995
    target   = "pop.fastmail.com"
  }
}

resource "cloudflare_record" "shepherdjerred_com_srv_pop3" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "_pop3._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_record" "shepherdjerred_com_srv_submission" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "_submission._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 1
    port     = 587
    target   = "smtp.fastmail.com"
  }
}

# ── TXT ─────────────────────────────────────────────────────────────────────

resource "cloudflare_record" "shepherdjerred_com_spf" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "shepherdjerred.com"
  type    = "TXT"
  content = "v=spf1 include:spf.messagingengine.com ~all"
}

resource "cloudflare_record" "shepherdjerred_com_dmarc" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=quarantine; rua=mailto:jerred@shepherdjerred.com"
}

# DNSSEC
resource "cloudflare_zone_dnssec" "shepherdjerred_com" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
}
