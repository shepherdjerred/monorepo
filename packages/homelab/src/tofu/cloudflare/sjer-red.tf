resource "cloudflare_zone" "sjer_red" {
  account_id = var.cloudflare_account_id
  zone       = "sjer.red"
}

# ── CNAMEs (Cloudflare Tunnel services) ─────────────────────────────────────

resource "cloudflare_record" "sjer_red_cname_apex" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "sjer.red"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_argocd" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "argocd"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_better_skill_capped_com" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "better-skill-capped.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_bluemap_ts_mc_net" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "bluemap.ts-mc.net"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_bugsink_shepherdjerred_com" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "bugsink.shepherdjerred.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_bugsink" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "bugsink"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_chartmuseum" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "chartmuseum"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_clauderon_com" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "clauderon.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_coder" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "coder"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_discord_plays_pokemon_com" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "discord-plays-pokemon.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# files.sjer.red CNAME is auto-managed by Cloudflare R2 custom domain

resource "cloudflare_record" "sjer_red_cname_freshrss" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "freshrss"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_homeassistant" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "homeassistant"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_overseerr" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "overseerr"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_peertube" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "peertube"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_plausible" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "plausible"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_plex" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "plex"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_pokebot" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "pokebot"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_resume" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "resume"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_scout_for_lol_com" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "scout-for-lol.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_seaweedfs" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "seaweedfs"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_shuxin_bluemap" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "shuxin.bluemap"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_sjerred_bluemap" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "sjerred.bluemap"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_ts_mc_net" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "ts-mc.net"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

resource "cloudflare_record" "sjer_red_cname_webring" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "webring"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# FastMail DKIM
resource "cloudflare_record" "sjer_red_dkim_fm1" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "fm1._domainkey"
  type    = "CNAME"
  content = "fm1.sjer.red.dkim.fmhosted.com"
  proxied = false
}

resource "cloudflare_record" "sjer_red_dkim_fm2" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "fm2._domainkey"
  type    = "CNAME"
  content = "fm2.sjer.red.dkim.fmhosted.com"
  proxied = false
}

resource "cloudflare_record" "sjer_red_dkim_fm3" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "fm3._domainkey"
  type    = "CNAME"
  content = "fm3.sjer.red.dkim.fmhosted.com"
  proxied = false
}

# ── MX (FastMail) ───────────────────────────────────────────────────────────

resource "cloudflare_record" "sjer_red_mx1" {
  zone_id  = cloudflare_zone.sjer_red.id
  name     = "sjer.red"
  type     = "MX"
  content  = "in1-smtp.messagingengine.com"
  priority = 10
}

resource "cloudflare_record" "sjer_red_mx2" {
  zone_id  = cloudflare_zone.sjer_red.id
  name     = "sjer.red"
  type     = "MX"
  content  = "in2-smtp.messagingengine.com"
  priority = 20
}

resource "cloudflare_record" "sjer_red_mx_rp1" {
  zone_id  = cloudflare_zone.sjer_red.id
  name     = "rp"
  type     = "MX"
  content  = "in1-smtp.messagingengine.com"
  priority = 10
}

resource "cloudflare_record" "sjer_red_mx_rp2" {
  zone_id  = cloudflare_zone.sjer_red.id
  name     = "rp"
  type     = "MX"
  content  = "in2-smtp.messagingengine.com"
  priority = 20
}

# ── SRV (FastMail autodiscovery) ────────────────────────────────────────────

resource "cloudflare_record" "sjer_red_srv_caldavs" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_caldavs._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 1
    port     = 443
    target   = "caldav.fastmail.com"
  }
}

resource "cloudflare_record" "sjer_red_srv_caldav" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_caldav._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_record" "sjer_red_srv_carddavs" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_carddavs._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 1
    port     = 443
    target   = "carddav.fastmail.com"
  }
}

resource "cloudflare_record" "sjer_red_srv_carddav" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_carddav._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_record" "sjer_red_srv_imaps" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_imaps._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 1
    port     = 993
    target   = "imap.fastmail.com"
  }
}

resource "cloudflare_record" "sjer_red_srv_imap" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_imap._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_record" "sjer_red_srv_minecraft" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_minecraft._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "mc.sjer.red"
  }
}

resource "cloudflare_record" "sjer_red_srv_minecraft_shuxin" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_minecraft._tcp.shuxin"
  type    = "SRV"
  data {
    priority = 0
    weight   = 5
    port     = 30000
    target   = "shuxin.sjer.red"
  }
}

resource "cloudflare_record" "sjer_red_srv_pop3s" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_pop3s._tcp"
  type    = "SRV"
  data {
    priority = 10
    weight   = 1
    port     = 995
    target   = "pop.fastmail.com"
  }
}

resource "cloudflare_record" "sjer_red_srv_pop3" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_pop3._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 0
    port     = 0
    target   = "."
  }
}

resource "cloudflare_record" "sjer_red_srv_submission" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_submission._tcp"
  type    = "SRV"
  data {
    priority = 0
    weight   = 1
    port     = 587
    target   = "smtp.fastmail.com"
  }
}

# ── TXT ─────────────────────────────────────────────────────────────────────

resource "cloudflare_record" "sjer_red_spf" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "sjer.red"
  type    = "TXT"
  content = "v=spf1 include:spf.messagingengine.com ~all"
}

resource "cloudflare_record" "sjer_red_dmarc" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_dmarc"
  type    = "TXT"
  content = "v=DMARC1; p=quarantine; rua=mailto:dmarc@sjer.red"
}

resource "cloudflare_record" "sjer_red_spf_rp" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "rp"
  type    = "TXT"
  content = "v=spf1 include:spf.messagingengine.com ~all"
}

# Postal DKIM keys
resource "cloudflare_record" "sjer_red_dkim_postal_aoolxx" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "postal-aoolxx._domainkey"
  type    = "TXT"
  content = "v=DKIM1; t=s; h=sha256; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDFfuKrHpylh2b4GmkgNWYNOkD5LypiaG8T4rDFR/3erk8ZE2fT7Z5ycQcyt+WdVlaN4VhT4phGNLr1rdXNRpUMFZV6uvOFqy2vzvHLaYSiNaYGONdhBe8L1af67XXMsxUbNO8kbyVkSkvpPS9hnz7/qZBfd0glRoGdNI64NQyHlwIDAQAB;"
}

resource "cloudflare_record" "sjer_red_dkim_postal_isna7c" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "postal-isna7c._domainkey"
  type    = "TXT"
  content = "v=DKIM1; t=s; h=sha256; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC55pcuuiIJO3bp3vDbFn2Hjr0z/W+1hJ0QOzsFm2elKfTujgIj1ExZ7B2nTCsNzv+OLZr8jNhk6dy6az0hafC7JV+Cm0z+N7P99Fj7+R6hfkVuOuXlhG3XsL16/RXdowAxjmXi9mDPHy3l0hqlMyfUmcrtdhydbLR4E2X4FdKQHwIDAQAB;"
}

# Legacy ACME challenges (Tailscale certs)
resource "cloudflare_record" "sjer_red_acme_influxdb" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_acme-challenge.influxdb.ts.zeus"
  type    = "TXT"
  content = "I0A35eU62OobpAKrT9PFPBg1TYnOatgNusx0lgBmuLw"
}

resource "cloudflare_record" "sjer_red_acme_syncthing" {
  zone_id = cloudflare_zone.sjer_red.id
  name    = "_acme-challenge.syncthing.ts.zeus"
  type    = "TXT"
  content = "FR8t1KHtHXWGKfERJqTZVcPitpVKmAKENo6auaz9OV0"
}

# DNSSEC
resource "cloudflare_zone_dnssec" "sjer_red" {
  zone_id = cloudflare_zone.sjer_red.id
}
