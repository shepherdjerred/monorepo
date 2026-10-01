# Adopt existing control-plane settings rather than relying on implicit defaults.
# The zone import remains in statically-typed-com.tf.

import {
  for_each = local.baseline_zone_ids
  to       = module.domain_baseline[each.key].cloudflare_zone_setting.ssl
  id       = "${each.value}/ssl"
}

import {
  for_each = local.baseline_zone_ids
  to       = module.domain_baseline[each.key].cloudflare_zone_setting.https
  id       = "${each.value}/always_use_https"
}

import {
  for_each = local.baseline_zone_ids
  to       = module.domain_baseline[each.key].cloudflare_zone_setting.tls_1_3
  id       = "${each.value}/tls_1_3"
}

import {
  for_each = local.baseline_zone_ids
  to       = module.domain_baseline[each.key].cloudflare_ct_alerting.ct
  id       = each.value
}

import {
  to = module.domain_baseline["statically-typed.com"].cloudflare_zone_setting.min_tls_version
  id = "d4036b55fca60ca5f998866309e951d8/min_tls_version"
}

import {
  to = module.domain_baseline["statically-typed.com"].cloudflare_zone_setting.security_header
  id = "d4036b55fca60ca5f998866309e951d8/security_header"
}

import {
  to = module.domain_baseline["statically-typed.com"].cloudflare_zone_dnssec.dnssec
  id = "d4036b55fca60ca5f998866309e951d8"
}
