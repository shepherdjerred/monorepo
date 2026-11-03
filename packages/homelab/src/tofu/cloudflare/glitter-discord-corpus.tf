# The Glitter Discord corpus is written to SeaweedFS only; this R2 bucket was
# an unused leftover. Stop managing it without destroying it; an operator
# deletes the empty bucket out-of-band.
removed {
  from = cloudflare_r2_bucket.glitter_discord_corpus

  lifecycle {
    destroy = false
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
