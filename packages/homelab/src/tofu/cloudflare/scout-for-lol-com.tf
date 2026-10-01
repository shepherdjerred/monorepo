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

resource "cloudflare_dns_record" "scout_for_lol_com_cname_design" {
  zone_id = cloudflare_zone.scout_for_lol_com.id
  ttl     = 1
  name    = "design"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}


# ── Static-asset caching: respect the immutable Cache-Control the deploy sets on
# content-hashed assets + Smart Tiered Cache (origin shielding). ───────────────
module "scout_for_lol_com_static_cache" {
  source         = "./modules/static-cache"
  zone_id        = cloudflare_zone.scout_for_lol_com.id
  asset_prefixes = ["/_astro/", "/app/assets/"]
}
