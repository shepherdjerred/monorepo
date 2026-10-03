resource "cloudflare_zone" "statically_typed_com" {
  account = { id = var.cloudflare_account_id }
  name    = "statically-typed.com"
  type    = "full"
  paused  = false
}

# Adopt the existing Cloudflare Registrar zone through the normal CI apply.
import {
  to = cloudflare_zone.statically_typed_com
  id = "d4036b55fca60ca5f998866309e951d8"
}
