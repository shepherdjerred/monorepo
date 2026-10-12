resource "cloudflare_zone" "better_skill_capped_com" {
  account = { id = var.cloudflare_account_id }
  name    = "better-skill-capped.com"
}

# Apex CNAME to Cloudflare Tunnel
resource "cloudflare_dns_record" "better_skill_capped_com_cname_apex" {
  zone_id = cloudflare_zone.better_skill_capped_com.id
  ttl     = 1
  name    = "better-skill-capped.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}


# ── Static-asset caching: respect the immutable Cache-Control the deploy sets on
# content-hashed assets + Smart Tiered Cache (origin shielding). ───────────────
module "better_skill_capped_com_static_cache" {
  source         = "./modules/static-cache"
  zone_id        = cloudflare_zone.better_skill_capped_com.id
  asset_prefixes = ["/assets/"]
}
