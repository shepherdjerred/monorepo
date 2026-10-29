# Velero's scheduled backups, which write to Cloudflare R2, are the only
# backup. Nothing ever wrote to these Backblaze buckets. Stop managing them
# without destroying them; an operator deletes them out-of-band.
removed {
  from = b2_bucket.seaweedfs_backups

  lifecycle {
    destroy = false
  }
}

removed {
  from = b2_bucket.velero

  lifecycle {
    destroy = false
  }
}

removed {
  from = b2_bucket.postgres_wal

  lifecycle {
    destroy = false
  }
}
