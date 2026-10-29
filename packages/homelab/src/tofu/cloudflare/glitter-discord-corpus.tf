# Unused. The Glitter Discord corpus is written to SeaweedFS only. This bucket
# is leftover and is not a live mirror.
resource "cloudflare_r2_bucket" "glitter_discord_corpus" {
  account_id = var.cloudflare_account_id
  name       = "glitter-discord-corpus"
  location   = "WNAM"

  lifecycle {
    prevent_destroy = true
  }
}

# The SeaweedFS object backup to `seaweedfs-backups` is retired: Velero's
# scheduled backups are the only backup. Stop managing the bucket, its object
# lock and its lifecycle without destroying anything; an operator empties and
# deletes the bucket out-of-band once its 30-day locks have expired.
removed {
  from = cloudflare_r2_bucket.seaweedfs_backups

  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_r2_bucket_lock.seaweedfs_backups

  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_r2_bucket_lifecycle.seaweedfs_backups

  lifecycle {
    destroy = false
  }
}
