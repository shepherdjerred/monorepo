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

resource "cloudflare_dns_record" "ts_mc_net_cname_docs" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "docs"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# storage.ts-mc.net CNAME is auto-managed by Cloudflare R2 custom domain

# ── SRV ─────────────────────────────────────────────────────────────────────

resource "cloudflare_dns_record" "ts_mc_net_srv_minecraft" {
  zone_id  = cloudflare_zone.ts_mc_net.id
  ttl      = 1
  name     = "_minecraft._tcp"
  type     = "SRV"
  priority = 0
  data = {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "mc.ts-mc.net"
  }
}
