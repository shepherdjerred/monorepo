# The `homelab` bucket held Velero's backups and ZFS streams until Velero moved
# to the Backblaze `sjerred-velero` bucket (`backblaze` stack). Stop managing
# it without destroying it; an operator empties and deletes it out-of-band.
removed {
  from = cloudflare_r2_bucket.homelab

  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_r2_bucket_lifecycle.homelab

  lifecycle {
    destroy = false
  }
}
