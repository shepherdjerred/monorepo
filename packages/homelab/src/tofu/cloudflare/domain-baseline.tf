locals {
  domain_registry = jsondecode(file("${path.module}/../../domain-registry.json"))
  baseline_zone_ids = {
    "better-skill-capped.com"   = cloudflare_zone.better_skill_capped_com.id
    "clauderon.com"             = cloudflare_zone.clauderon_com.id
    "discord-plays-pokemon.com" = cloudflare_zone.discord_plays_pokemon_com.id
    "glitter-boys.com"          = cloudflare_zone.glitter_boys_com.id
    "jerredshepherd.com"        = cloudflare_zone.jerredshepherd_com.id
    "scout-for-lol.com"         = cloudflare_zone.scout_for_lol_com.id
    "shepherdjerred.com"        = cloudflare_zone.shepherdjerred_com.id
    "sjer.red"                  = cloudflare_zone.sjer_red.id
    "statically-typed.com"      = cloudflare_zone.statically_typed_com.id
    "ts-mc.net"                 = cloudflare_zone.ts_mc_net.id
  }
}

output "managed_domains" {
  description = "Domains covered by the shared security and mail baseline."
  value       = keys(local.domain_registry.domains)
  precondition {
    condition     = toset(keys(local.domain_registry.domains)) == toset(keys(local.baseline_zone_ids))
    error_message = "Every Cloudflare zone must have exactly one domain registry entry and baseline binding."
  }
}

module "domain_baseline" {
  source            = "./modules/domain-baseline"
  for_each          = local.domain_registry.domains
  zone_id           = local.baseline_zone_ids[each.key]
  domain            = each.key
  fastmail_ready    = each.value.fastmailReady
  wildcard_mail     = each.value.wildcardMail
  tls_1_3           = each.value.tls13
  mta_sts_published = each.value.mtaStsPublished
  mail_policy       = local.domain_registry.mailPolicy
}
