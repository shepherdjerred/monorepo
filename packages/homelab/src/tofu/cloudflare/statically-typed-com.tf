resource "cloudflare_zone" "statically_typed_com" {
  account = { id = var.cloudflare_account_id }
  name    = "statically-typed.com"
  type    = "full"
  paused  = false
}

resource "cloudflare_dns_record" "statically_typed_com_cname_apex" {
  zone_id = cloudflare_zone.statically_typed_com.id
  ttl     = 1
  name    = "statically-typed.com"
  type    = "CNAME"
  content = "3cbdc9a6-9e79-412d-8fe1-60117fecd4d3.cfargotunnel.com"
  proxied = true
}

# Adopt the existing Cloudflare Registrar zone through the normal CI apply.
import {
  to = cloudflare_zone.statically_typed_com
  id = "d4036b55fca60ca5f998866309e951d8"
}
