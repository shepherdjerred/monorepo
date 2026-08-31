# Off-site mirror for the loss-intolerant Glitter Discord corpus. R2 S3
# credentials are minted manually with Object Read & Write access scoped to
# this bucket and stored in the Temporal worker's 1Password item.
resource "cloudflare_r2_bucket" "glitter_discord_corpus" {
  account_id = var.cloudflare_account_id
  name       = "glitter-discord-corpus"
  location   = "WNAM"

  lifecycle {
    prevent_destroy = true
  }
}

# Object-level off-site recovery for the protected SeaweedFS buckets. Backup
# payloads and completed snapshot metadata are immutable for 30 days; the
# backup worker's two-phase collector waits longer than that before deletion.
resource "cloudflare_r2_bucket" "seaweedfs_backups" {
  account_id    = var.cloudflare_account_id
  name          = "seaweedfs-backups"
  location      = "WNAM"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket_lock" "seaweedfs_backups" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.seaweedfs_backups.name

  rules = [
    {
      id      = "immutable-backup-objects-30d"
      enabled = true
      prefix  = "objects/"
      condition = {
        type            = "Age"
        max_age_seconds = 2592000
      }
    },
    {
      id      = "immutable-snapshots-30d"
      enabled = true
      prefix  = "snapshots/"
      condition = {
        type            = "Age"
        max_age_seconds = 2592000
      }
    },
  ]
}

resource "cloudflare_r2_bucket_lifecycle" "seaweedfs_backups" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.seaweedfs_backups.name

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
