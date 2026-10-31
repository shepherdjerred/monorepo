# Preserve existing resource identities when adopting the shared domain baseline.

moved {
  from = cloudflare_zone_dnssec.better_skill_capped_com
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_zone_dnssec.dnssec
}

moved {
  from = cloudflare_zone_setting.better_skill_capped_com_min_tls_version
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_zone_setting.min_tls_version
}

moved {
  from = cloudflare_zone_setting.better_skill_capped_com_security_header
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_zone_setting.security_header
}

moved {
  from = cloudflare_dns_record.better_skill_capped_com_spf
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_dns_record.spf
}

moved {
  from = cloudflare_dns_record.better_skill_capped_com_dmarc
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_dns_record.dmarc
}

moved {
  from = cloudflare_dns_record.better_skill_capped_com_caa_iodef
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_dns_record.caa_iodef
}

moved {
  from = cloudflare_dns_record.better_skill_capped_com_caa_issue_letsencrypt
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_dns_record.caa_issue["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.better_skill_capped_com_caa_issue_google_trust_services
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_dns_record.caa_issue["google_trust_services"]
}

moved {
  from = cloudflare_dns_record.better_skill_capped_com_caa_issue_sectigo
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_dns_record.caa_issue["sectigo"]
}

moved {
  from = cloudflare_dns_record.better_skill_capped_com_caa_issue_ssl_com
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_dns_record.caa_issue["ssl_com"]
}

moved {
  from = cloudflare_dns_record.better_skill_capped_com_caa_issuewild_none
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_dns_record.caa_issuewild["letsencrypt"]
}

moved {
  from = cloudflare_zone_dnssec.clauderon_com
  to   = module.domain_baseline["clauderon.com"].cloudflare_zone_dnssec.dnssec
}

moved {
  from = cloudflare_zone_setting.clauderon_com_min_tls_version
  to   = module.domain_baseline["clauderon.com"].cloudflare_zone_setting.min_tls_version
}

moved {
  from = cloudflare_zone_setting.clauderon_com_security_header
  to   = module.domain_baseline["clauderon.com"].cloudflare_zone_setting.security_header
}

moved {
  from = cloudflare_dns_record.clauderon_com_spf
  to   = module.domain_baseline["clauderon.com"].cloudflare_dns_record.spf
}

moved {
  from = cloudflare_dns_record.clauderon_com_dmarc
  to   = module.domain_baseline["clauderon.com"].cloudflare_dns_record.dmarc
}

moved {
  from = cloudflare_dns_record.clauderon_com_caa_iodef
  to   = module.domain_baseline["clauderon.com"].cloudflare_dns_record.caa_iodef
}

moved {
  from = cloudflare_dns_record.clauderon_com_caa_issue_letsencrypt
  to   = module.domain_baseline["clauderon.com"].cloudflare_dns_record.caa_issue["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.clauderon_com_caa_issue_google_trust_services
  to   = module.domain_baseline["clauderon.com"].cloudflare_dns_record.caa_issue["google_trust_services"]
}

moved {
  from = cloudflare_dns_record.clauderon_com_caa_issue_sectigo
  to   = module.domain_baseline["clauderon.com"].cloudflare_dns_record.caa_issue["sectigo"]
}

moved {
  from = cloudflare_dns_record.clauderon_com_caa_issue_ssl_com
  to   = module.domain_baseline["clauderon.com"].cloudflare_dns_record.caa_issue["ssl_com"]
}

moved {
  from = cloudflare_dns_record.clauderon_com_caa_issuewild_none
  to   = module.domain_baseline["clauderon.com"].cloudflare_dns_record.caa_issuewild["letsencrypt"]
}

moved {
  from = cloudflare_zone_dnssec.discord_plays_pokemon_com
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_zone_dnssec.dnssec
}

moved {
  from = cloudflare_zone_setting.discord_plays_pokemon_com_min_tls_version
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_zone_setting.min_tls_version
}

moved {
  from = cloudflare_zone_setting.discord_plays_pokemon_com_security_header
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_zone_setting.security_header
}

moved {
  from = cloudflare_dns_record.discord_plays_pokemon_com_spf
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_dns_record.spf
}

moved {
  from = cloudflare_dns_record.discord_plays_pokemon_com_dmarc
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_dns_record.dmarc
}

moved {
  from = cloudflare_dns_record.discord_plays_pokemon_com_caa_iodef
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_dns_record.caa_iodef
}

moved {
  from = cloudflare_dns_record.discord_plays_pokemon_com_caa_issue_letsencrypt
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_dns_record.caa_issue["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.discord_plays_pokemon_com_caa_issue_google_trust_services
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_dns_record.caa_issue["google_trust_services"]
}

moved {
  from = cloudflare_dns_record.discord_plays_pokemon_com_caa_issue_sectigo
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_dns_record.caa_issue["sectigo"]
}

moved {
  from = cloudflare_dns_record.discord_plays_pokemon_com_caa_issue_ssl_com
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_dns_record.caa_issue["ssl_com"]
}

moved {
  from = cloudflare_dns_record.discord_plays_pokemon_com_caa_issuewild_none
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_dns_record.caa_issuewild["letsencrypt"]
}

moved {
  from = cloudflare_zone_dnssec.glitter_boys_com
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_zone_dnssec.dnssec
}

moved {
  from = cloudflare_zone_setting.glitter_boys_com_min_tls_version
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_zone_setting.min_tls_version
}

moved {
  from = cloudflare_zone_setting.glitter_boys_com_security_header
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_zone_setting.security_header
}

moved {
  from = cloudflare_dns_record.glitter_boys_com_spf
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_dns_record.spf
}

moved {
  from = cloudflare_dns_record.glitter_boys_com_dmarc
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_dns_record.dmarc
}

moved {
  from = cloudflare_dns_record.glitter_boys_com_caa_iodef
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_dns_record.caa_iodef
}

moved {
  from = cloudflare_dns_record.glitter_boys_com_caa_issue_letsencrypt
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_dns_record.caa_issue["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.glitter_boys_com_caa_issue_google_trust_services
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_dns_record.caa_issue["google_trust_services"]
}

moved {
  from = cloudflare_dns_record.glitter_boys_com_caa_issue_sectigo
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_dns_record.caa_issue["sectigo"]
}

moved {
  from = cloudflare_dns_record.glitter_boys_com_caa_issue_ssl_com
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_dns_record.caa_issue["ssl_com"]
}

moved {
  from = cloudflare_dns_record.glitter_boys_com_caa_issuewild_none
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_dns_record.caa_issuewild["letsencrypt"]
}

moved {
  from = cloudflare_zone_dnssec.jerredshepherd_com
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_zone_dnssec.dnssec
}

moved {
  from = cloudflare_zone_setting.jerredshepherd_com_min_tls_version
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_zone_setting.min_tls_version
}

moved {
  from = cloudflare_zone_setting.jerredshepherd_com_security_header
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_zone_setting.security_header
}

moved {
  from = cloudflare_dns_record.jerredshepherd_com_spf
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_dns_record.spf
}

moved {
  from = cloudflare_dns_record.jerredshepherd_com_dmarc
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_dns_record.dmarc
}

moved {
  from = cloudflare_dns_record.jerredshepherd_com_caa_iodef
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_dns_record.caa_iodef
}

moved {
  from = cloudflare_dns_record.jerredshepherd_com_caa_issue_letsencrypt
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_dns_record.caa_issue["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.jerredshepherd_com_caa_issue_google_trust_services
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_dns_record.caa_issue["google_trust_services"]
}

moved {
  from = cloudflare_dns_record.jerredshepherd_com_caa_issue_sectigo
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_dns_record.caa_issue["sectigo"]
}

moved {
  from = cloudflare_dns_record.jerredshepherd_com_caa_issue_ssl_com
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_dns_record.caa_issue["ssl_com"]
}

moved {
  from = cloudflare_dns_record.jerredshepherd_com_caa_issuewild_none
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_dns_record.caa_issuewild["letsencrypt"]
}

moved {
  from = cloudflare_zone_dnssec.scout_for_lol_com
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_zone_dnssec.dnssec
}

moved {
  from = cloudflare_zone_setting.scout_for_lol_com_min_tls_version
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_zone_setting.min_tls_version
}

moved {
  from = cloudflare_zone_setting.scout_for_lol_com_security_header
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_zone_setting.security_header
}

moved {
  from = cloudflare_dns_record.scout_for_lol_com_spf
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_dns_record.spf
}

moved {
  from = cloudflare_dns_record.scout_for_lol_com_dmarc
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_dns_record.dmarc
}

moved {
  from = cloudflare_dns_record.scout_for_lol_com_caa_iodef
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_dns_record.caa_iodef
}

moved {
  from = cloudflare_dns_record.scout_for_lol_com_caa_issue_letsencrypt
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_dns_record.caa_issue["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.scout_for_lol_com_caa_issue_google_trust_services
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_dns_record.caa_issue["google_trust_services"]
}

moved {
  from = cloudflare_dns_record.scout_for_lol_com_caa_issue_sectigo
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_dns_record.caa_issue["sectigo"]
}

moved {
  from = cloudflare_dns_record.scout_for_lol_com_caa_issue_ssl_com
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_dns_record.caa_issue["ssl_com"]
}

moved {
  from = cloudflare_dns_record.scout_for_lol_com_caa_issuewild_none
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_dns_record.caa_issuewild["letsencrypt"]
}

moved {
  from = cloudflare_zone_dnssec.shepherdjerred_com
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_zone_dnssec.dnssec
}

moved {
  from = cloudflare_zone_setting.shepherdjerred_com_min_tls_version
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_zone_setting.min_tls_version
}

moved {
  from = cloudflare_zone_setting.shepherdjerred_com_security_header
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_zone_setting.security_header
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_spf
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.spf
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_dmarc
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.dmarc
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_tlsrpt
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.tlsrpt
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_caa_iodef
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.caa_iodef
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_caa_issue_letsencrypt
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.caa_issue["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_caa_issue_google_trust_services
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.caa_issue["google_trust_services"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_caa_issue_sectigo
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.caa_issue["sectigo"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_caa_issue_ssl_com
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.caa_issue["ssl_com"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_caa_issuewild_none
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.caa_issuewild["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_dkim_fm1
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.dkim["fm1"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_dkim_fm2
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.dkim["fm2"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_dkim_fm3
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.dkim["fm3"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_mx1
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.mx["primary"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_mx2
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.mx["secondary"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_mx_wildcard1
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.wildcard_mx["primary"]
}

moved {
  from = cloudflare_dns_record.shepherdjerred_com_mx_wildcard2
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_dns_record.wildcard_mx["secondary"]
}

moved {
  from = cloudflare_zone_dnssec.sjer_red
  to   = module.domain_baseline["sjer.red"].cloudflare_zone_dnssec.dnssec
}

moved {
  from = cloudflare_zone_setting.sjer_red_min_tls_version
  to   = module.domain_baseline["sjer.red"].cloudflare_zone_setting.min_tls_version
}

moved {
  from = cloudflare_zone_setting.sjer_red_security_header
  to   = module.domain_baseline["sjer.red"].cloudflare_zone_setting.security_header
}

moved {
  from = cloudflare_dns_record.sjer_red_spf
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.spf
}

moved {
  from = cloudflare_dns_record.sjer_red_dmarc
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.dmarc
}

moved {
  from = cloudflare_dns_record.sjer_red_tlsrpt
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.tlsrpt
}

moved {
  from = cloudflare_dns_record.sjer_red_caa_iodef
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.caa_iodef
}

moved {
  from = cloudflare_dns_record.sjer_red_caa_issue_letsencrypt
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.caa_issue["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.sjer_red_caa_issue_google_trust_services
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.caa_issue["google_trust_services"]
}

moved {
  from = cloudflare_dns_record.sjer_red_caa_issue_sectigo
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.caa_issue["sectigo"]
}

moved {
  from = cloudflare_dns_record.sjer_red_caa_issue_ssl_com
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.caa_issue["ssl_com"]
}

moved {
  from = cloudflare_dns_record.sjer_red_caa_issuewild_none
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.caa_issuewild["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.sjer_red_dkim_fm1
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.dkim["fm1"]
}

moved {
  from = cloudflare_dns_record.sjer_red_dkim_fm2
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.dkim["fm2"]
}

moved {
  from = cloudflare_dns_record.sjer_red_dkim_fm3
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.dkim["fm3"]
}

moved {
  from = cloudflare_dns_record.sjer_red_mx1
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.mx["primary"]
}

moved {
  from = cloudflare_dns_record.sjer_red_mx2
  to   = module.domain_baseline["sjer.red"].cloudflare_dns_record.mx["secondary"]
}

moved {
  from = cloudflare_dns_record.sjer_red_dmarc_report_better_skill_capped_com
  to   = cloudflare_dns_record.dmarc_report["better-skill-capped.com"]
}

moved {
  from = cloudflare_dns_record.sjer_red_dmarc_report_clauderon_com
  to   = cloudflare_dns_record.dmarc_report["clauderon.com"]
}

moved {
  from = cloudflare_dns_record.sjer_red_dmarc_report_discord_plays_pokemon_com
  to   = cloudflare_dns_record.dmarc_report["discord-plays-pokemon.com"]
}

moved {
  from = cloudflare_dns_record.sjer_red_dmarc_report_glitter_boys_com
  to   = cloudflare_dns_record.dmarc_report["glitter-boys.com"]
}

moved {
  from = cloudflare_dns_record.sjer_red_dmarc_report_jerredshepherd_com
  to   = cloudflare_dns_record.dmarc_report["jerredshepherd.com"]
}

moved {
  from = cloudflare_dns_record.sjer_red_dmarc_report_scout_for_lol_com
  to   = cloudflare_dns_record.dmarc_report["scout-for-lol.com"]
}

moved {
  from = cloudflare_dns_record.sjer_red_dmarc_report_ts_mc_net
  to   = cloudflare_dns_record.dmarc_report["ts-mc.net"]
}

moved {
  from = cloudflare_zone_dnssec.ts_mc_net
  to   = module.domain_baseline["ts-mc.net"].cloudflare_zone_dnssec.dnssec
}

moved {
  from = cloudflare_zone_setting.ts_mc_net_min_tls_version
  to   = module.domain_baseline["ts-mc.net"].cloudflare_zone_setting.min_tls_version
}

moved {
  from = cloudflare_zone_setting.ts_mc_net_security_header
  to   = module.domain_baseline["ts-mc.net"].cloudflare_zone_setting.security_header
}

moved {
  from = cloudflare_dns_record.ts_mc_net_spf
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.spf
}

moved {
  from = cloudflare_dns_record.ts_mc_net_dmarc
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.dmarc
}

moved {
  from = cloudflare_dns_record.ts_mc_net_tlsrpt
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.tlsrpt
}

moved {
  from = cloudflare_dns_record.ts_mc_net_caa_iodef
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.caa_iodef
}

moved {
  from = cloudflare_dns_record.ts_mc_net_caa_issue_letsencrypt
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.caa_issue["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_caa_issue_google_trust_services
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.caa_issue["google_trust_services"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_caa_issue_sectigo
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.caa_issue["sectigo"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_caa_issue_ssl_com
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.caa_issue["ssl_com"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_caa_issuewild_none
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.caa_issuewild["letsencrypt"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_dkim_fm1
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.dkim["fm1"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_dkim_fm2
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.dkim["fm2"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_dkim_fm3
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.dkim["fm3"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_mx1
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.mx["primary"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_mx2
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.mx["secondary"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_mx_wildcard1
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.wildcard_mx["primary"]
}

moved {
  from = cloudflare_dns_record.ts_mc_net_mx_wildcard2
  to   = module.domain_baseline["ts-mc.net"].cloudflare_dns_record.wildcard_mx["secondary"]
}
