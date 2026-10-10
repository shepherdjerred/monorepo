resource "cloudflare_zone" "glitter_boys_com" {
  account = { id = var.cloudflare_account_id }
  name    = "glitter-boys.com"
}

# Fly.io app CNAMEs
resource "cloudflare_dns_record" "glitter_boys_com_cname_beta" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "beta"
  type    = "CNAME"
  content = "glitter-boys-beta.fly.dev"
  proxied = false
}

resource "cloudflare_dns_record" "glitter_boys_com_cname_prod" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "prod"
  type    = "CNAME"
  content = "glitter-boys-prod.fly.dev"
  proxied = false
}

# Homelab static site: Cloudflare Tunnel → s3-static-sites Caddy → glitter-boys-ppl bucket
resource "cloudflare_dns_record" "glitter_boys_com_cname_ppl" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "ppl"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Main-domain Astro/Starlight site, served by the homelab static-site service.
resource "cloudflare_dns_record" "glitter_boys_com_cname_apex" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "glitter-boys.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Desktop telemetry ingress, owned by the launcher homelab chart.
resource "cloudflare_dns_record" "glitter_boys_com_cname_launcher" {
  zone_id = cloudflare_zone.glitter_boys_com.id
  ttl     = 1
  name    = "launcher"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}
