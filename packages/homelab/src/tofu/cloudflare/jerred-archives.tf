# Private, off-site storage for personal archives retired from active sync.
resource "cloudflare_r2_bucket" "jerred_archives" {
  account_id    = var.cloudflare_account_id
  name          = "jerred-archives"
  location      = "WNAM"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_managed_domain" "jerred_archives" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.jerred_archives.name
  enabled     = false
}

# Remove abandoned upload parts without expiring completed archives.
resource "cloudflare_r2_bucket_lifecycle" "jerred_archives" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.jerred_archives.name

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
