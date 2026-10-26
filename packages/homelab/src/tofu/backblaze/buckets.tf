# Account region is chosen when the Backblaze account is created. us-west-004
# is the region these buckets and the S3 endpoint assume.
locals {
  region      = "us-west-004"
  s3_endpoint = "https://s3.us-west-004.backblazeb2.com"
  # Completed objects are not expired. Abandoned large-file parts are
  # canceled after 7 days. A hidden version stays for 30 days, so an
  # accidental hide can be restored, and is then removed.
  version_lifecycle = {
    file_name_prefix                                       = ""
    days_from_starting_to_canceling_unfinished_large_files = 7
    days_from_hiding_to_deleting                           = 30
  }
  bucket_ids = {
    seaweedfs_backups = b2_bucket.seaweedfs_backups.bucket_id
    velero            = b2_bucket.velero.bucket_id
    postgres_wal      = b2_bucket.postgres_wal.bucket_id
  }
}

resource "b2_bucket" "seaweedfs_backups" {
  bucket_name = "seaweedfs-backups"
  bucket_type = "allPrivate"

  # File Lock is on so later writes can retain objects/ and snapshots/.
  # There is no default retention: gc/ must stay deletable.
  file_lock_configuration {
    is_file_lock_enabled = true
  }

  lifecycle_rules {
    file_name_prefix                                       = local.version_lifecycle.file_name_prefix
    days_from_starting_to_canceling_unfinished_large_files = local.version_lifecycle.days_from_starting_to_canceling_unfinished_large_files
    days_from_hiding_to_deleting                           = local.version_lifecycle.days_from_hiding_to_deleting
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "b2_bucket" "velero" {
  bucket_name = "sjerred-velero"
  bucket_type = "allPrivate"

  # Object Lock stays off. A default retention period applies to every
  # object, and Velero must delete expired backups and their ZFS streams.
  lifecycle_rules {
    file_name_prefix                                       = local.version_lifecycle.file_name_prefix
    days_from_starting_to_canceling_unfinished_large_files = local.version_lifecycle.days_from_starting_to_canceling_unfinished_large_files
    days_from_hiding_to_deleting                           = local.version_lifecycle.days_from_hiding_to_deleting
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "b2_bucket" "postgres_wal" {
  bucket_name = "sjerred-postgres-wal"
  bucket_type = "allPrivate"

  # Object Lock stays off. WAL-G deletes base backups and segments itself.
  lifecycle_rules {
    file_name_prefix                                       = local.version_lifecycle.file_name_prefix
    days_from_starting_to_canceling_unfinished_large_files = local.version_lifecycle.days_from_starting_to_canceling_unfinished_large_files
    days_from_hiding_to_deleting                           = local.version_lifecycle.days_from_hiding_to_deleting
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "s3_endpoint" {
  description = "S3-compatible endpoint for the account region."
  value       = local.s3_endpoint
}

output "region" {
  description = "Backblaze region these buckets belong to."
  value       = local.region
}

output "bucket_names" {
  description = "Private backup buckets. seaweedfs-backups keeps the name Delivery receipts store."
  value = {
    seaweedfs_backups = b2_bucket.seaweedfs_backups.bucket_name
    velero            = b2_bucket.velero.bucket_name
    postgres_wal      = b2_bucket.postgres_wal.bucket_name
  }
}
