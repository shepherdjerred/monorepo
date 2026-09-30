# Velero backup bucket for the homelab cluster: `torvalds/backups/` backup
# metadata plus `zfspv-incr/` volume snapshot data. This bucket predates
# OpenTofu management and is adopted via the import block below; it must never
# be created or destroyed by this stack.
import {
  to = cloudflare_r2_bucket.homelab
  # Import ids cannot reference sensitive variables; the account id below is
  # the same value as var.cloudflare_account_id (also visible in every R2 URL).
  id = "48948ed6cd40d73e34d27f0cc10e595f/homelab/default"
}

resource "cloudflare_r2_bucket" "homelab" {
  account_id = var.cloudflare_account_id
  name       = "homelab"
  location   = "WNAM"

  lifecycle {
    prevent_destroy = true
  }
}

# Hygiene only: reap abandoned multipart upload parts (e.g. fragments left by a
# PartiallyFailed snapshot upload such as 6hourly-backup-20260922181523). There
# are deliberately no expiry rules here: Velero TTL finalizers own object
# deletion, and prefix expiry would corrupt the zfspv incremental chains whose
# fulls anchor later incrementals.
resource "cloudflare_r2_bucket_lifecycle" "homelab" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.homelab.name

  rules = [
    {
      id         = "abort-incomplete-multipart-uploads-7d"
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
