resource "cloudflare_zone" "discord_plays_pokemon_com" {
  account = { id = var.cloudflare_account_id }
  name    = "discord-plays-pokemon.com"
}

# The MkDocs site that used to live here was retired when the bot went headless.
# The apex now 301-redirects to the package README on GitHub (see the dynamic
# redirect ruleset below). The record is a proxied IPv6 discard address
# (RFC 6666 100::/64) — Cloudflare's edge answers and runs the redirect ruleset
# before any origin fetch, so the address is never actually contacted.
resource "cloudflare_dns_record" "discord_plays_pokemon_com_apex" {
  zone_id = cloudflare_zone.discord_plays_pokemon_com.id
  ttl     = 1
  name    = "discord-plays-pokemon.com"
  type    = "AAAA"
  content = "100::"
  proxied = true
}

# 301 every request (apex + any path) to the package README on GitHub.
resource "cloudflare_ruleset" "discord_plays_pokemon_com_redirect" {
  zone_id = cloudflare_zone.discord_plays_pokemon_com.id
  name    = "discord-plays-pokemon.com to GitHub README"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [{
    ref         = "dpp_apex_to_github_readme"
    description = "Redirect to the discord-plays-pokemon package README on GitHub"
    expression  = "(http.host eq \"discord-plays-pokemon.com\")"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = false
        target_url = {
          value = "https://github.com/shepherdjerred/monorepo/tree/main/packages/discord-plays-pokemon"
        }
      }
    }
  }]
}
