locals {
  # Homelab vault synced by the cluster 1Password operator.
  vault_id = "v64ocnykdqju4ui6j6pua56xw4"
  keys = {
    seaweedfs_backups = {
      title = "backblaze-seaweedfs-backups"
      # Velero alone reads an AWS credentials file (`cloud`); see below.
      aws_credentials_file = false
      capabilities = [
        "listBuckets",
        "listFiles",
        "readFiles",
        "writeFiles",
        "deleteFiles",
        "readFileRetentions",
        "writeFileRetentions",
      ]
    }
    velero = {
      title                = "backblaze-velero"
      aws_credentials_file = true
      capabilities = [
        "listBuckets",
        "listFiles",
        "readFiles",
        "writeFiles",
        "deleteFiles",
      ]
    }
    postgres_wal = {
      title                = "backblaze-postgres-wal"
      aws_credentials_file = false
      capabilities = [
        "listBuckets",
        "listFiles",
        "readFiles",
        "writeFiles",
        "deleteFiles",
      ]
    }
  }
}

resource "b2_application_key" "backup" {
  for_each = local.keys

  key_name     = each.value.title
  capabilities = each.value.capabilities
  bucket_ids   = [local.bucket_ids[each.key]]
}

resource "onepassword_item" "backup" {
  for_each = local.keys

  vault    = local.vault_id
  title    = each.value.title
  category = "secure_note"

  section {
    label = "credentials"

    field {
      label = "B2_ACCESS_KEY_ID"
      type  = "CONCEALED"
      value = b2_application_key.backup[each.key].application_key_id
    }

    field {
      label = "B2_SECRET_ACCESS_KEY"
      type  = "CONCEALED"
      value = b2_application_key.backup[each.key].application_key
    }

    # The Velero chart mounts its secret's `cloud` key as the AWS shared
    # credentials file that Velero and the openebs plugin authenticate with.
    dynamic "field" {
      for_each = each.value.aws_credentials_file ? [true] : []

      content {
        label = "cloud"
        type  = "CONCEALED"
        value = <<-EOT
          [default]
          aws_access_key_id=${b2_application_key.backup[each.key].application_key_id}
          aws_secret_access_key=${b2_application_key.backup[each.key].application_key}
        EOT
      }
    }
  }
}
