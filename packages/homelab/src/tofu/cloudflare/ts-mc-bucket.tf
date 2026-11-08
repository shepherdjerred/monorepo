# Public downloads for The Storm, such as legacy world snapshots, served at
# storage.ts-mc.net. Public reads are intentional.
import {
  to = cloudflare_r2_bucket.ts_mc
  id = "${nonsensitive(var.cloudflare_account_id)}/ts-mc/default"
}

resource "cloudflare_r2_bucket" "ts_mc" {
  account_id    = var.cloudflare_account_id
  name          = "ts-mc"
  location      = "WNAM"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

# The bucket is public only through the storage.ts-mc.net custom domain, which
# also owns that DNS record. The provider cannot import a custom domain, so its
# state entry was adopted from a refresh of the live domain (see the README).
# Destroying it takes the public downloads offline.
resource "cloudflare_r2_custom_domain" "ts_mc" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.ts_mc.name
  domain      = "storage.ts-mc.net"
  zone_id     = cloudflare_zone.ts_mc_net.id
  enabled     = true

  lifecycle {
    prevent_destroy = true
  }
}

# The r2.dev development URL stays disabled.
resource "cloudflare_r2_managed_domain" "ts_mc" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.ts_mc.name
  enabled     = false
}

# Remove abandoned upload parts without expiring published objects. The rule
# keeps the id and age R2 created it with.
resource "cloudflare_r2_bucket_lifecycle" "ts_mc" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.ts_mc.name

  rules = [
    {
      id         = "Default Multipart Abort Rule"
      enabled    = true
      conditions = { prefix = "" }
      abort_multipart_uploads_transition = {
        condition = {
          type    = "Age"
          max_age = 604800
        }
      }
    },
  ]
}
