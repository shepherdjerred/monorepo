resource "cloudflare_zone" "sjer_red" {
  account = { id = var.cloudflare_account_id }
  name    = "sjer.red"
}

# ── CNAMEs (Cloudflare Tunnel services) ─────────────────────────────────────

resource "cloudflare_dns_record" "sjer_red_cname_apex" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "sjer.red"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_argocd" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "argocd"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_better_skill_capped_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "better-skill-capped.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_bluemap_ts_mc_net" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "bluemap.ts-mc.net"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_bugsink_shepherdjerred_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "bugsink.shepherdjerred.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_bugsink" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "bugsink"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_chartmuseum" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "chartmuseum"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_clauderon_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "clauderon.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_discord_plays_pokemon_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "discord-plays-pokemon.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# files.sjer.red CNAME is auto-managed by Cloudflare R2 custom domain

resource "cloudflare_dns_record" "sjer_red_cname_freshrss" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "freshrss"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_homeassistant" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "homeassistant"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_jellyfin" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "jellyfin"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Kept for the Overseerr→Seerr redirect (see cloudflare_ruleset
# "sjer_red_redirects" in this file). The origin is gone; the edge redirect
# ruleset intercepts every request before the tunnel is contacted.
resource "cloudflare_dns_record" "sjer_red_cname_overseerr" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "overseerr"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_peertube" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "peertube"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_plausible" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "plausible"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_plex" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "plex"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_pokebot" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "pokebot"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_mariokart" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "mariokart"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Receives GitHub `pull_request` webhooks for the temporal worker's pr-agent
# (prReview / prSummary workflows). TunnelBinding lives in cdk8s; this DNS
# record completes the public path. See packages/temporal/AGENTS.md.
resource "cloudflare_dns_record" "sjer_red_cname_pr_bot" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "pr-bot"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_temporal_agent_tasks" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "temporal-agent-tasks"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Receives Xcode Cloud build webhooks (tasks-for-obsidian iOS app). The temporal
# worker's receiver (event-bridge/xcode-cloud-webhook.ts) translates FAILED/
# ERRORED builds into Alertmanager alerts. TunnelBinding lives in cdk8s; this
# DNS record completes the public path. See packages/temporal/AGENTS.md.
resource "cloudflare_dns_record" "sjer_red_cname_xcode_cloud_webhook" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "xcode-cloud-webhook"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Self-hosted Relay Server (Obsidian real-time collaboration). TunnelBinding
# lives in cdk8s (src/cdk8s/src/resources/relay); this record completes the
# public path. Clients (Obsidian Relay plugin) connect over wss://relay.sjer.red.
resource "cloudflare_dns_record" "sjer_red_cname_relay" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "relay"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_seerr" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "seerr"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Overseerr was migrated to Seerr (users + request history imported into the
# Seerr DB, 2026-07-03). The overseerr.sjer.red record is intentionally kept as
# a proxied CNAME (above) so the hostname still resolves through Cloudflare; the
# dynamic-redirect ruleset below runs at the edge *before* any origin fetch and
# 301s every request to seerr.sjer.red (path + query preserved), so the
# now-routeless tunnel target is never actually contacted.
resource "cloudflare_ruleset" "sjer_red_redirects" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "sjer.red dynamic redirects"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [{
    ref         = "overseerr_to_seerr"
    description = "Redirect overseerr.sjer.red to seerr.sjer.red (Overseerr retired)"
    expression  = "(http.host eq \"overseerr.sjer.red\")"
    action      = "redirect"
    action_parameters = {
      from_value = {
        status_code           = 301
        preserve_query_string = true
        target_url = {
          expression = "concat(\"https://seerr.sjer.red\", http.request.uri.path)"
        }
      }
    }
  }]
}

resource "cloudflare_dns_record" "sjer_red_cname_resume" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "resume"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# seaweedfs.sjer.red removed 2026-06-27: the SeaweedFS S3 API is now tailnet-only
# (reachable via seaweedfs-s3.tailnet-1a49.ts.net). The state + llm-archive buckets
# live on this gateway, so it is no longer exposed on the public Cloudflare tunnel.
# All S3 consumers that previously used this public hostname have been migrated:
#   - CI static-site deploy containers (.dagger/src/release.ts)
#   - Operator ~/.aws/config default + seaweedfs profiles (packages/dotfiles/)
#   - Tofu state backends (already used seaweedfs-s3.tailnet-1a49.ts.net)

resource "cloudflare_dns_record" "sjer_red_cname_shuxin_bluemap" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "shuxin.bluemap"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_sjerred_bluemap" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "sjerred.bluemap"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_ts_mc_net" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "ts-mc.net"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_birmel_oauth" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "birmel-oauth"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_webring" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "webring"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_cook" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "cook"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_stocks" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "stocks"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_public" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "public"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_dns_record" "sjer_red_cname_trmnl" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "trmnl"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# ── CNAMEs (Minecraft modded servers → ddns for mc-router) ────────────────────

resource "cloudflare_dns_record" "sjer_red_cname_allthemons" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "allthemons"
  type    = "CNAME"
  content = "ddns.sjer.red"
  proxied = false
}

resource "cloudflare_dns_record" "sjer_red_cname_stoneblock4" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "stoneblock4"
  type    = "CNAME"
  content = "ddns.sjer.red"
  proxied = false
}

resource "cloudflare_dns_record" "sjer_red_cname_bettermc" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "bettermc"
  type    = "CNAME"
  content = "ddns.sjer.red"
  proxied = false
}

resource "cloudflare_dns_record" "sjer_red_cname_allofcreate" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "allofcreate"
  type    = "CNAME"
  content = "ddns.sjer.red"
  proxied = false
}

resource "cloudflare_dns_record" "sjer_red_cname_ftbskies2" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "ftbskies2"
  type    = "CNAME"
  content = "ddns.sjer.red"
  proxied = false
}

# SRV records for Minecraft modded servers (port 30000 = mc-router NodePort)

resource "cloudflare_dns_record" "sjer_red_srv_minecraft_allthemons" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_minecraft._tcp.allthemons"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "allthemons.sjer.red"
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_minecraft_stoneblock4" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_minecraft._tcp.stoneblock4"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "stoneblock4.sjer.red"
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_minecraft_bettermc" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_minecraft._tcp.bettermc"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "bettermc.sjer.red"
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_minecraft_allofcreate" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_minecraft._tcp.allofcreate"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "allofcreate.sjer.red"
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_minecraft_ftbskies2" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_minecraft._tcp.ftbskies2"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "ftbskies2.sjer.red"
  }
}

# FastMail DKIM
resource "cloudflare_dns_record" "sjer_red_dkim_fm1" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "fm1._domainkey"
  type    = "CNAME"
  content = "fm1.sjer.red.dkim.fmhosted.com"
  proxied = false
}

resource "cloudflare_dns_record" "sjer_red_dkim_fm2" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "fm2._domainkey"
  type    = "CNAME"
  content = "fm2.sjer.red.dkim.fmhosted.com"
  proxied = false
}

resource "cloudflare_dns_record" "sjer_red_dkim_fm3" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "fm3._domainkey"
  type    = "CNAME"
  content = "fm3.sjer.red.dkim.fmhosted.com"
  proxied = false
}

# ── MX (FastMail) ───────────────────────────────────────────────────────────

resource "cloudflare_dns_record" "sjer_red_mx1" {
  zone_id  = cloudflare_zone.sjer_red.id
  ttl      = 1
  name     = "sjer.red"
  type     = "MX"
  content  = "in1-smtp.messagingengine.com"
  priority = 10
}

resource "cloudflare_dns_record" "sjer_red_mx2" {
  zone_id  = cloudflare_zone.sjer_red.id
  ttl      = 1
  name     = "sjer.red"
  type     = "MX"
  content  = "in2-smtp.messagingengine.com"
  priority = 20
}

resource "cloudflare_dns_record" "sjer_red_mx_rp1" {
  zone_id  = cloudflare_zone.sjer_red.id
  ttl      = 1
  name     = "rp"
  type     = "MX"
  content  = "in1-smtp.messagingengine.com"
  priority = 10
}

resource "cloudflare_dns_record" "sjer_red_mx_rp2" {
  zone_id  = cloudflare_zone.sjer_red.id
  ttl      = 1
  name     = "rp"
  type     = "MX"
  content  = "in2-smtp.messagingengine.com"
  priority = 20
}

# ── SRV (FastMail autodiscovery) ────────────────────────────────────────────

resource "cloudflare_dns_record" "sjer_red_srv_caldavs" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_caldavs._tcp"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 1
    port     = 443
    target   = "caldav.fastmail.com"
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_caldav" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_caldav._tcp"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_carddavs" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_carddavs._tcp"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 1
    port     = 443
    target   = "carddav.fastmail.com"
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_carddav" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_carddav._tcp"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_imaps" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_imaps._tcp"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 1
    port     = 993
    target   = "imap.fastmail.com"
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_imap" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_imap._tcp"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_minecraft" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_minecraft._tcp"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "mc.sjer.red"
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_minecraft_shuxin" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_minecraft._tcp.shuxin"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "shuxin.sjer.red"
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_pop3s" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_pop3s._tcp"
  type    = "SRV"
  data = {
    priority = 10
    weight   = 1
    port     = 995
    target   = "pop.fastmail.com"
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_pop3" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_pop3._tcp"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_dns_record" "sjer_red_srv_submission" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_submission._tcp"
  type    = "SRV"
  data = {
    priority = 0
    weight   = 1
    port     = 587
    target   = "smtp.fastmail.com"
  }
}

# ── TXT ─────────────────────────────────────────────────────────────────────

resource "cloudflare_dns_record" "sjer_red_spf" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "sjer.red"
  type    = "TXT"
  content = "v=spf1 include:spf.messagingengine.com -all"
}

resource "cloudflare_dns_record" "sjer_red_dmarc" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=reject; rua=mailto:dmarc@sjer.red; ruf=mailto:dmarc@sjer.red; fo=1"
}

# DMARC aggregate report authorization for external domains (RFC 7489 §7.1)
resource "cloudflare_dns_record" "sjer_red_dmarc_report_ts_mc_net" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "ts-mc.net._report._dmarc"
  type    = "TXT"
  content = "v=DMARC1"
}

resource "cloudflare_dns_record" "sjer_red_dmarc_report_scout_for_lol_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "scout-for-lol.com._report._dmarc"
  type    = "TXT"
  content = "v=DMARC1"
}

resource "cloudflare_dns_record" "sjer_red_dmarc_report_better_skill_capped_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "better-skill-capped.com._report._dmarc"
  type    = "TXT"
  content = "v=DMARC1"
}

resource "cloudflare_dns_record" "sjer_red_dmarc_report_discord_plays_pokemon_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "discord-plays-pokemon.com._report._dmarc"
  type    = "TXT"
  content = "v=DMARC1"
}

resource "cloudflare_dns_record" "sjer_red_dmarc_report_clauderon_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "clauderon.com._report._dmarc"
  type    = "TXT"
  content = "v=DMARC1"
}

resource "cloudflare_dns_record" "sjer_red_dmarc_report_jerred_is" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "jerred.is._report._dmarc"
  type    = "TXT"
  content = "v=DMARC1"
}

resource "cloudflare_dns_record" "sjer_red_dmarc_report_jerredshepherd_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "jerredshepherd.com._report._dmarc"
  type    = "TXT"
  content = "v=DMARC1"
}

resource "cloudflare_dns_record" "sjer_red_dmarc_report_glitter_boys_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "glitter-boys.com._report._dmarc"
  type    = "TXT"
  content = "v=DMARC1"
}

resource "cloudflare_dns_record" "sjer_red_spf_rp" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "rp"
  type    = "TXT"
  content = "v=spf1 include:spf.messagingengine.com -all"
}

# Postal DKIM keys
resource "cloudflare_dns_record" "sjer_red_dkim_postal_aoolxx" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "postal-aoolxx._domainkey"
  type    = "TXT"
  content = "v=DKIM1; t=s; h=sha256; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDFfuKrHpylh2b4GmkgNWYNOkD5LypiaG8T4rDFR/3erk8ZE2fT7Z5ycQcyt+WdVlaN4VhT4phGNLr1rdXNRpUMFZV6uvOFqy2vzvHLaYSiNaYGONdhBe8L1af67XXMsxUbNO8kbyVkSkvpPS9hnz7/qZBfd0glRoGdNI64NQyHlwIDAQAB;"
}

resource "cloudflare_dns_record" "sjer_red_dkim_postal_isna7c" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "postal-isna7c._domainkey"
  type    = "TXT"
  content = "v=DKIM1; t=s; h=sha256; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC55pcuuiIJO3bp3vDbFn2Hjr0z/W+1hJ0QOzsFm2elKfTujgIj1ExZ7B2nTCsNzv+OLZr8jNhk6dy6az0hafC7JV+Cm0z+N7P99Fj7+R6hfkVuOuXlhG3XsL16/RXdowAxjmXi9mDPHy3l0hqlMyfUmcrtdhydbLR4E2X4FdKQHwIDAQAB;"
}

# Legacy ACME challenges (Tailscale certs)
resource "cloudflare_dns_record" "sjer_red_acme_influxdb" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_acme-challenge.influxdb.ts.zeus"
  type    = "TXT"
  content = "I0A35eU62OobpAKrT9PFPBg1TYnOatgNusx0lgBmuLw"
}

resource "cloudflare_dns_record" "sjer_red_acme_syncthing" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_acme-challenge.syncthing.ts.zeus"
  type    = "TXT"
  content = "FR8t1KHtHXWGKfERJqTZVcPitpVKmAKENo6auaz9OV0"
}

# DNSSEC
resource "cloudflare_zone_dnssec" "sjer_red" {
  zone_id = cloudflare_zone.sjer_red.id
}

# ── CAA: authorize CAs Cloudflare may use to issue certs for this zone ─────
resource "cloudflare_dns_record" "sjer_red_caa_issue_letsencrypt" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "sjer.red"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "letsencrypt.org"
  }
}

resource "cloudflare_dns_record" "sjer_red_caa_issue_google_trust_services" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "sjer.red"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "pki.goog; cansignhttpexchanges=yes"
  }
}

resource "cloudflare_dns_record" "sjer_red_caa_issue_sectigo" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "sjer.red"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "sectigo.com"
  }
}

resource "cloudflare_dns_record" "sjer_red_caa_issue_ssl_com" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "sjer.red"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issue"
    value = "ssl.com"
  }
}

resource "cloudflare_dns_record" "sjer_red_caa_issuewild_none" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "sjer.red"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "issuewild"
    value = ";"
  }
}

resource "cloudflare_dns_record" "sjer_red_caa_iodef" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "sjer.red"
  type    = "CAA"
  data = {
    flags = 0
    tag   = "iodef"
    value = "mailto:dmarc@sjer.red"
  }
}

# ── Edge hardening: min TLS 1.2 + HSTS (1-day rollback window) ──────────────
resource "cloudflare_zone_setting" "sjer_red_min_tls_version" {
  zone_id    = cloudflare_zone.sjer_red.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "sjer_red_security_header" {
  zone_id    = cloudflare_zone.sjer_red.id
  setting_id = "security_header"
  value = {
    strict_transport_security = {
      enabled            = true
      max_age            = 86400
      include_subdomains = true
      nosniff            = true
      preload            = false
    }
  }
}

# ── TLSRPT: ask senders to report STARTTLS failures ─────────────────────────
resource "cloudflare_dns_record" "sjer_red_tlsrpt" {
  zone_id = cloudflare_zone.sjer_red.id
  ttl     = 1
  name    = "_smtp._tls"
  type    = "TXT"
  content = "v=TLSRPTv1; rua=mailto:dmarc@sjer.red"
}

# ── Static-asset caching: respect the immutable Cache-Control the deploy sets on
# content-hashed assets (sjer.red + the cook./stocks. Astro subdomains in this
# zone all emit `/_astro/`) + Smart Tiered Cache (origin shielding). ───────────
module "sjer_red_static_cache" {
  source         = "./modules/static-cache"
  zone_id        = cloudflare_zone.sjer_red.id
  asset_prefixes = ["/_astro/"]
}
