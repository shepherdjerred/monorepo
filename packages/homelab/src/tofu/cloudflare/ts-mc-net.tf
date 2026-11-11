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

resource "cloudflare_dns_record" "ts_mc_net_cname_livemap" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "livemap"
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

resource "cloudflare_dns_record" "ts_mc_net_cname_public" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "public"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "ts_mc_net_cname_join" {
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "join"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# ── Dynamic Redirects ───────────────────────────────────────────────────────

resource "cloudflare_ruleset" "ts_mc_net_redirects" {
  zone_id = cloudflare_zone.ts_mc_net.id
  name    = "ts-mc.net dynamic redirects"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [{
    ref         = "join_to_the_storm"
    description = "Redirect join.ts-mc.net to The Storm landing page"
    expression  = "(http.host eq \"join.ts-mc.net\")"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = true
        target_url = {
          value = "https://public.ts-mc.net/the-storm/"
        }
      }
    }
  }]
}

# The storage.ts-mc.net record belongs to cloudflare_r2_custom_domain.ts_mc.

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

resource "cloudflare_dns_record" "ts_mc_net_srv_minecraft_join" {
  zone_id  = cloudflare_zone.ts_mc_net.id
  ttl      = 1
  name     = "_minecraft._tcp.join"
  type     = "SRV"
  priority = 0
  data = {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "mc.ts-mc.net"
  }
}
