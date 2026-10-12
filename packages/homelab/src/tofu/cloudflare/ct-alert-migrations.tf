# Keep the adopted zone identities while configuring delivery for new alerts.
moved {
  from = module.domain_baseline["better-skill-capped.com"].cloudflare_ct_alerting.ct
  to   = module.domain_baseline["better-skill-capped.com"].cloudflare_ct_alerting.ct_existing[0]
}
moved {
  from = module.domain_baseline["clauderon.com"].cloudflare_ct_alerting.ct
  to   = module.domain_baseline["clauderon.com"].cloudflare_ct_alerting.ct[0]
}
moved {
  from = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_ct_alerting.ct
  to   = module.domain_baseline["discord-plays-pokemon.com"].cloudflare_ct_alerting.ct[0]
}
moved {
  from = module.domain_baseline["glitter-boys.com"].cloudflare_ct_alerting.ct
  to   = module.domain_baseline["glitter-boys.com"].cloudflare_ct_alerting.ct[0]
}
moved {
  from = module.domain_baseline["jerredshepherd.com"].cloudflare_ct_alerting.ct
  to   = module.domain_baseline["jerredshepherd.com"].cloudflare_ct_alerting.ct[0]
}
moved {
  from = module.domain_baseline["scout-for-lol.com"].cloudflare_ct_alerting.ct
  to   = module.domain_baseline["scout-for-lol.com"].cloudflare_ct_alerting.ct[0]
}
moved {
  from = module.domain_baseline["shepherdjerred.com"].cloudflare_ct_alerting.ct
  to   = module.domain_baseline["shepherdjerred.com"].cloudflare_ct_alerting.ct[0]
}
moved {
  from = module.domain_baseline["sjer.red"].cloudflare_ct_alerting.ct
  to   = module.domain_baseline["sjer.red"].cloudflare_ct_alerting.ct[0]
}
moved {
  from = module.domain_baseline["statically-typed.com"].cloudflare_ct_alerting.ct
  to   = module.domain_baseline["statically-typed.com"].cloudflare_ct_alerting.ct[0]
}
moved {
  from = module.domain_baseline["ts-mc.net"].cloudflare_ct_alerting.ct
  to   = module.domain_baseline["ts-mc.net"].cloudflare_ct_alerting.ct[0]
}
