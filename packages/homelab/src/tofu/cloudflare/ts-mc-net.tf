resource "cloudflare_zone" "ts_mc_net" {
  account_id = var.cloudflare_account_id
  zone       = "ts-mc.net"
}

# ── A records ───────────────────────────────────────────────────────────────

resource "cloudflare_record" "ts_mc_net_a_minecraft" {
  zone_id = cloudflare_zone.ts_mc_net.id
  name    = "minecraft"
  type    = "A"
  content = "15.204.44.15"
  proxied = false
}

# ── CNAMEs ──────────────────────────────────────────────────────────────────

resource "cloudflare_record" "ts_mc_net_cname_apex" {
  zone_id = cloudflare_zone.ts_mc_net.id
  name    = "ts-mc.net"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "ts_mc_net_cname_bluemap" {
  zone_id = cloudflare_zone.ts_mc_net.id
  name    = "bluemap"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# storage.ts-mc.net CNAME is auto-managed by Cloudflare R2 custom domain

# FastMail DKIM
resource "cloudflare_record" "ts_mc_net_dkim_fm1" {
  zone_id = cloudflare_zone.ts_mc_net.id
  name    = "fm1._domainkey"
  type    = "CNAME"
  content = "fm1.ts-mc.net.dkim.fmhosted.com"
  proxied = false
}

resource "cloudflare_record" "ts_mc_net_dkim_fm2" {
  zone_id = cloudflare_zone.ts_mc_net.id
  name    = "fm2._domainkey"
  type    = "CNAME"
  content = "fm2.ts-mc.net.dkim.fmhosted.com"
  proxied = false
}

resource "cloudflare_record" "ts_mc_net_dkim_fm3" {
  zone_id = cloudflare_zone.ts_mc_net.id
  name    = "fm3._domainkey"
  type    = "CNAME"
  content = "fm3.ts-mc.net.dkim.fmhosted.com"
  proxied = false
}

# ── MX (FastMail) ───────────────────────────────────────────────────────────

resource "cloudflare_record" "ts_mc_net_mx1" {
  zone_id  = cloudflare_zone.ts_mc_net.id
  name     = "ts-mc.net"
  type     = "MX"
  content  = "in1-smtp.messagingengine.com"
  priority = 10
}

resource "cloudflare_record" "ts_mc_net_mx2" {
  zone_id  = cloudflare_zone.ts_mc_net.id
  name     = "ts-mc.net"
  type     = "MX"
  content  = "in2-smtp.messagingengine.com"
  priority = 20
}

resource "cloudflare_record" "ts_mc_net_mx_wildcard1" {
  zone_id  = cloudflare_zone.ts_mc_net.id
  name     = "*"
  type     = "MX"
  content  = "in1-smtp.messagingengine.com"
  priority = 10
}

resource "cloudflare_record" "ts_mc_net_mx_wildcard2" {
  zone_id  = cloudflare_zone.ts_mc_net.id
  name     = "*"
  type     = "MX"
  content  = "in2-smtp.messagingengine.com"
  priority = 20
}

# ── SRV ─────────────────────────────────────────────────────────────────────

resource "cloudflare_record" "ts_mc_net_srv_minecraft" {
  zone_id = cloudflare_zone.ts_mc_net.id
  name    = "_minecraft._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "mc.ts-mc.net"
  }
}

# ── TXT ─────────────────────────────────────────────────────────────────────

resource "cloudflare_record" "ts_mc_net_spf" {
  zone_id = cloudflare_zone.ts_mc_net.id
  name    = "ts-mc.net"
  type    = "TXT"
  content = "v=spf1 include:spf.messagingengine.com ~all"
}

resource "cloudflare_record" "ts_mc_net_dmarc" {
  zone_id = cloudflare_zone.ts_mc_net.id
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;"
}

# DNSSEC
resource "cloudflare_zone_dnssec" "ts_mc_net" {
  zone_id = cloudflare_zone.ts_mc_net.id
}
