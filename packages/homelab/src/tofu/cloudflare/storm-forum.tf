resource "cloudflare_turnstile_widget" "storm_forum" {
  account_id = var.cloudflare_account_id
  name       = "The Storm forum"
  domains    = ["ts-mc.net", "storm-forum-beta.tailnet-1a49.ts.net"]
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
