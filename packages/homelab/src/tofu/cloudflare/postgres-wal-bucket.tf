# Continuous WAL-G archive for the operator-run PostgreSQL data layers
# (delivery-postgresql and temporal-postgresql; see
# packages/homelab/src/cdk8s/src/resources/postgres/wal-archive.ts). Each
# cluster writes under its own `<cluster-name>/` prefix. WAL-G owns retention
# (`BACKUP_NUM_TO_RETAIN` through `wal-g delete retain`), so there is
# deliberately no age-based expiry here: expiring a base backup by age would
# orphan the WAL segments that point-in-time recovery between the remaining
# backups still needs. Credentials are a bucket-scoped Object Read & Write
# token from the `cloudflare-tokens` stack.
resource "cloudflare_r2_bucket" "postgres_wal" {
  account_id    = var.cloudflare_account_id
  name          = "postgres-wal"
  location      = "WNAM"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

# Hygiene only: reap abandoned multipart upload parts.
resource "cloudflare_r2_bucket_lifecycle" "postgres_wal" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.postgres_wal.name

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
