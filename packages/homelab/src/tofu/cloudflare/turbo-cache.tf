# R2 bucket backing the self-hosted Turborepo remote cache
# (ducktors/turborepo-remote-cache with STORAGE_PROVIDER=s3).
# See packages/docs/plans/2026-07-12_workspace-taskgraph-replatform.md (Phase 3)
# and 2026-07-12_turbo-buildout-derisk.md (R2 round-trip PoC).
#
# S3 access credentials for the bucket are NOT managed here: R2 S3 tokens are
# minted in the dashboard (R2 → Manage API Tokens → scoped to this bucket,
# Object Read & Write) and stored in 1Password. The cloudflare TF provider's
# api-token resource cannot mint R2 S3 keypairs.

resource "cloudflare_r2_bucket" "turbo_cache" {
  account_id = var.cloudflare_account_id
  name       = "turbo-cache"
  location   = "WNAM"
}

# Cache artifacts are disposable — expire them so the bucket self-limits.
resource "cloudflare_r2_bucket_lifecycle" "turbo_cache" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.turbo_cache.name

  rules = [{
    id      = "expire-cache-artifacts"
    enabled = true
    conditions = {
      prefix = ""
    }
    delete_objects_transition = {
      condition = {
        max_age = 2592000 # 30 days
        type    = "Age"
      }
    }
  }]
}
