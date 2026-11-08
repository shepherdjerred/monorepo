# Public file downloads served at files.sjer.red. Public reads are intentional.
import {
  to = cloudflare_r2_bucket.sjerred
  id = "${nonsensitive(var.cloudflare_account_id)}/sjerred/default"
}

resource "cloudflare_r2_bucket" "sjerred" {
  account_id    = var.cloudflare_account_id
  name          = "sjerred"
  location      = "WNAM"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

# The bucket is public only through the files.sjer.red custom domain, which
# also owns that DNS record. The provider cannot import a custom domain, so its
# state entry was adopted from a refresh of the live domain (see the README).
# Destroying it takes the public downloads offline.
resource "cloudflare_r2_custom_domain" "sjerred" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.sjerred.name
  domain      = "files.sjer.red"
  zone_id     = cloudflare_zone.sjer_red.id
  enabled     = true

  lifecycle {
    prevent_destroy = true
  }
}

# The r2.dev development URL stays disabled.
resource "cloudflare_r2_managed_domain" "sjerred" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.sjerred.name
  enabled     = false
}

# Remove abandoned upload parts after one day without expiring published
# objects. The rule keeps the id and age R2 created it with.
resource "cloudflare_r2_bucket_lifecycle" "sjerred" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.sjerred.name

  rules = [
    {
      id         = "Default Multipart Abort Rule"
      enabled    = true
      conditions = { prefix = "" }
      abort_multipart_uploads_transition = {
        condition = {
          type    = "Age"
          max_age = 86400
        }
      }
    },
  ]
}
