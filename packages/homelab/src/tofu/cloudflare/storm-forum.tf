locals {
  storm_forum_public_enabled = anytrue([
    for release in jsondecode(file("${path.module}/../../cdk8s/src/resources/storm-forum/releases.json")).releases : release.stage == "prod"
  ])
}

# Keep public DNS inactive until the accepted production release is declared.
resource "cloudflare_dns_record" "ts_mc_net_cname_forum" {
  count   = local.storm_forum_public_enabled ? 1 : 0
  zone_id = cloudflare_zone.ts_mc_net.id
  ttl     = 1
  name    = "forum"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_turnstile_widget" "storm_forum" {
  account_id = var.cloudflare_account_id
  name       = "The Storm forum"
  domains    = ["forum.ts-mc.net", "storm-forum-beta.tailnet-1a49.ts.net"]
  mode       = "managed"
}

# Keys must be transferred from protected Tofu state into the dedicated
# 1Password runtime items through authenticated tooling, never repository files.
output "storm_forum_turnstile_site_key" {
  value     = cloudflare_turnstile_widget.storm_forum.sitekey
  sensitive = true
}
output "storm_forum_turnstile_secret_key" {
  value     = cloudflare_turnstile_widget.storm_forum.secret
  sensitive = true
}
