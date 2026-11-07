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

# The bucket is public only through its storage.ts-mc.net custom domain. The
# provider cannot import an existing cloudflare_r2_custom_domain, and creating
# one that already exists fails, so the domain stays attached out-of-band (see
# the note in ts-mc-net.tf). The r2.dev development URL stays disabled.
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
