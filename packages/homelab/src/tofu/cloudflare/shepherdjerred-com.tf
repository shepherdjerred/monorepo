resource "cloudflare_zone" "shepherdjerred_com" {
  account = { id = var.cloudflare_account_id }
  name    = "shepherdjerred.com"
}

# ── CNAMEs ──────────────────────────────────────────────────────────────────

# Redirect to sjer.red
resource "cloudflare_dns_record" "shepherdjerred_com_cname_apex" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  ttl     = 1
  name    = "shepherdjerred.com"
  type    = "CNAME"
  content = "sjer.red"
  proxied = false
}

resource "cloudflare_dns_record" "shepherdjerred_com_cname_www" {
  zone_id = cloudflare_zone.shepherdjerred_com.id
  ttl     = 1
  name    = "www"
  type    = "CNAME"
  content = "sjer.red"
  proxied = false
}

# ── SRV (FastMail autodiscovery) ────────────────────────────────────────────

resource "cloudflare_dns_record" "shepherdjerred_com_srv_caldavs" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  ttl      = 1
  name     = "_caldavs._tcp"
  type     = "SRV"
  priority = 0
  data = {
    priority = 0
    weight   = 1
    port     = 443
    target   = "caldav.fastmail.com"
  }
}

resource "cloudflare_dns_record" "shepherdjerred_com_srv_caldav" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  ttl      = 1
  name     = "_caldav._tcp"
  type     = "SRV"
  priority = 0
  data = {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_dns_record" "shepherdjerred_com_srv_carddavs" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  ttl      = 1
  name     = "_carddavs._tcp"
  type     = "SRV"
  priority = 0
  data = {
    priority = 0
    weight   = 1
    port     = 443
    target   = "carddav.fastmail.com"
  }
}

resource "cloudflare_dns_record" "shepherdjerred_com_srv_carddav" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  ttl      = 1
  name     = "_carddav._tcp"
  type     = "SRV"
  priority = 0
  data = {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_dns_record" "shepherdjerred_com_srv_imaps" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  ttl      = 1
  name     = "_imaps._tcp"
  type     = "SRV"
  priority = 0
  data = {
    priority = 0
    weight   = 1
    port     = 993
    target   = "imap.fastmail.com"
  }
}

resource "cloudflare_dns_record" "shepherdjerred_com_srv_imap" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  ttl      = 1
  name     = "_imap._tcp"
  type     = "SRV"
  priority = 0
  data = {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_dns_record" "shepherdjerred_com_srv_pop3s" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  ttl      = 1
  name     = "_pop3s._tcp"
  type     = "SRV"
  priority = 10
  data = {
    priority = 10
    weight   = 1
    port     = 995
    target   = "pop.fastmail.com"
  }
}

resource "cloudflare_dns_record" "shepherdjerred_com_srv_pop3" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  ttl      = 1
  name     = "_pop3._tcp"
  type     = "SRV"
  priority = 0
  data = {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_dns_record" "shepherdjerred_com_srv_submission" {
  zone_id  = cloudflare_zone.shepherdjerred_com.id
  ttl      = 1
  name     = "_submission._tcp"
  type     = "SRV"
  priority = 0
  data = {
    priority = 0
    weight   = 1
    port     = 587
    target   = "smtp.fastmail.com"
  }
}
