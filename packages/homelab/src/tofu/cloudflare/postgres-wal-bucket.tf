# The `postgres-wal` bucket was declared for a WAL-G archive that never used it
# (WAL-G wrote under the `homelab` bucket) and WAL archiving is retired:
# Velero's scheduled backups are the only backup. Stop managing the bucket
# without destroying it; an operator deletes it out-of-band. No-op if the
# resource was never in state.
removed {
  from = cloudflare_r2_bucket.postgres_wal

  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_r2_bucket_lifecycle.postgres_wal

  lifecycle {
    destroy = false
  }
}
