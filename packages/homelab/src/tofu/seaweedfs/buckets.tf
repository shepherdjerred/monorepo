# Static site buckets (served via Caddy s3proxy)
resource "aws_s3_bucket" "better_skill_capped" {
  bucket = "better-skill-capped"
}

resource "aws_s3_bucket" "clauderon" {
  bucket = "clauderon"
}

resource "aws_s3_bucket" "dpp_docs" {
  bucket = "dpp-docs"
}

resource "aws_s3_bucket" "resume" {
  bucket = "resume"
}

resource "aws_s3_bucket" "scout_frontend" {
  bucket = "scout-frontend"
}

resource "aws_s3_bucket" "sjer_red" {
  bucket = "sjer-red"
}

resource "aws_s3_bucket" "ts_mc" {
  bucket = "ts-mc"
}

resource "aws_s3_bucket" "webring" {
  bucket = "webring"
}

# Scout application storage
resource "aws_s3_bucket" "scout_beta" {
  bucket = "scout-beta"
}

resource "aws_s3_bucket" "scout_prod" {
  bucket = "scout-prod"
}

# Build cache with 30-day expiration
resource "aws_s3_bucket" "sccache" {
  bucket = "sccache"
}

resource "terraform_data" "sccache_lifecycle" {
  input = {
    bucket       = aws_s3_bucket.sccache.id
    expire_days  = 30
    endpoint_url = "https://seaweedfs-s3.tailnet-1a49.ts.net"
  }

  provisioner "local-exec" {
    command = <<-EOT
      aws s3api put-bucket-lifecycle-configuration \
        --bucket "${self.input.bucket}" \
        --endpoint-url "${self.input.endpoint_url}" \
        --lifecycle-configuration '{
          "Rules": [{
            "ID": "expire-cache-objects",
            "Status": "Enabled",
            "Filter": {"Prefix": ""},
            "Expiration": {"Days": ${self.input.expire_days}}
          }]
        }'
    EOT
  }
}

# OpenTofu state backend for all modules
resource "aws_s3_bucket" "homelab_tofu_state" {
  bucket = "homelab-tofu-state"

  lifecycle {
    prevent_destroy = true
  }
}
