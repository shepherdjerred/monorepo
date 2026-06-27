# Static site buckets (served via Caddy s3proxy)
resource "aws_s3_bucket" "better_skill_capped" {
  bucket = "better-skill-capped"
}

resource "aws_s3_bucket" "clauderon" {
  bucket = "clauderon"
}

resource "aws_s3_bucket" "resume" {
  bucket = "resume"
}

resource "aws_s3_bucket" "scout_frontend" {
  bucket = "scout-frontend"
}

resource "aws_s3_bucket" "scout_frontend_beta" {
  bucket = "scout-frontend-beta"
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

resource "aws_s3_bucket" "cook" {
  bucket = "cook"
}

# stocks.sjer.red. This bucket predates its IaC declaration: when stocks was
# wired into the deploy (commit 6d0aa524b) it was added to CI + Caddy + the Astro
# app but never to this file, and SeaweedFS's S3 gateway auto-created it on the
# first deploy sync (it auto-creates a bucket on first PutObject, unlike AWS S3).
# The bucket already exists, so the `import` block adopts it into state on the
# next apply rather than letting Tofu try to CreateBucket over it. This is
# declarative (no manual `tofu import`) and safe because the resource + import
# land on main together — a manual pre-merge import would leave state ahead of
# config and the next apply would destroy the bucket. The block is a no-op once
# the bucket is in state and may be removed after the first successful apply.
import {
  to = aws_s3_bucket.stocks_sjer_red
  id = "stocks-sjer-red"
}

resource "aws_s3_bucket" "stocks_sjer_red" {
  bucket = "stocks-sjer-red"
}

resource "aws_s3_bucket" "glitter_boys_ppl" {
  bucket = "glitter-boys-ppl"
}

# Expire old content-hashed assets 90 days after they were last written. The
# deploy (`deploySiteHelper`, .dagger/src/release.ts) uploads these prefixes with
# a 1-year `immutable` Cache-Control and WITHOUT `--delete`, so a deploy never
# 404s a hashed chunk that a still-open browser tab references. Every deploy
# re-uploads the current build's hashed files (fresh mtime resets their age), so
# only *prior* builds' hashes — no longer referenced by any live shell — age out.
# Prefixes mirror `immutablePrefixes` in scripts/ci/src/catalog.ts. Only buckets
# actively deployed by CI are listed; non-hashed sites (resume, webring, glitter)
# and buckets we don't deploy to are intentionally omitted.
locals {
  static_site_immutable_prefixes = {
    "scout-frontend"      = ["app/assets/", "_astro/"]
    "scout-frontend-beta" = ["app/assets/", "_astro/"]
    "sjer-red"            = ["_astro/"]
    "cook"                = ["_astro/"]
    "stocks-sjer-red"     = ["_astro/"]
    "better-skill-capped" = ["assets/"]
  }
}

resource "terraform_data" "static_site_asset_lifecycle" {
  for_each = local.static_site_immutable_prefixes

  # Ensure the bucket exists before configuring its lifecycle.
  depends_on = [
    aws_s3_bucket.scout_frontend,
    aws_s3_bucket.scout_frontend_beta,
    aws_s3_bucket.sjer_red,
    aws_s3_bucket.cook,
    aws_s3_bucket.stocks_sjer_red,
    aws_s3_bucket.better_skill_capped,
  ]

  input = {
    bucket       = each.key
    endpoint_url = "https://seaweedfs-s3.tailnet-1a49.ts.net"
    # Re-runs the provisioner whenever the prefix set or TTL changes.
    rules = jsonencode({
      Rules = [
        for idx, prefix in each.value : {
          ID         = "expire-old-hashed-${idx}"
          Status     = "Enabled"
          Filter     = { Prefix = prefix }
          Expiration = { Days = 90 }
        }
      ]
    })
  }

  provisioner "local-exec" {
    command = <<-EOT
      aws s3api put-bucket-lifecycle-configuration \
        --bucket "${self.input.bucket}" \
        --endpoint-url "${self.input.endpoint_url}" \
        --lifecycle-configuration '${self.input.rules}'
    EOT
  }
}

# Public artifact bucket — served at https://public.sjer.red via Caddy s3proxy.
# PR screenshots live under the `pr/assets/<number>/` prefix (365-day TTL, below);
# the bucket root is seeded with a landing + 404 page so the static-site root
# probe stays green.
resource "aws_s3_bucket" "public_sjer_red" {
  bucket = "public-sjer-red"
}

# Expire PR-asset objects after 365 days. Scoped to the `pr/assets/` prefix so
# any other public artifacts dropped in this bucket are retained indefinitely.
resource "terraform_data" "public_sjer_red_lifecycle" {
  input = {
    bucket       = aws_s3_bucket.public_sjer_red.id
    expire_days  = 365
    endpoint_url = "https://seaweedfs-s3.tailnet-1a49.ts.net"
  }

  provisioner "local-exec" {
    command = <<-EOT
      aws s3api put-bucket-lifecycle-configuration \
        --bucket "${self.input.bucket}" \
        --endpoint-url "${self.input.endpoint_url}" \
        --lifecycle-configuration '{
          "Rules": [{
            "ID": "expire-pr-assets",
            "Status": "Enabled",
            "Filter": {"Prefix": "pr/assets/"},
            "Expiration": {"Days": ${self.input.expire_days}}
          }]
        }'
    EOT
  }
}

# Seed the bucket root with a landing + 404 page so `GET /` returns 200 (keeps
# the static-site root blackbox probe green). Re-uploads whenever either file's
# content changes via the filemd5 triggers in `input`.
resource "terraform_data" "public_sjer_red_seed" {
  input = {
    bucket        = aws_s3_bucket.public_sjer_red.id
    endpoint_url  = "https://seaweedfs-s3.tailnet-1a49.ts.net"
    index_md5     = filemd5("${path.module}/public/index.html")
    not_found_md5 = filemd5("${path.module}/public/404.html")
  }

  provisioner "local-exec" {
    command = <<-EOT
      aws s3 cp "${path.module}/public/index.html" "s3://${self.input.bucket}/index.html" \
        --endpoint-url "${self.input.endpoint_url}" \
        --content-type "text/html; charset=utf-8"
      aws s3 cp "${path.module}/public/404.html" "s3://${self.input.bucket}/404.html" \
        --endpoint-url "${self.input.endpoint_url}" \
        --content-type "text/html; charset=utf-8"
    EOT
  }
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

# Bazel remote cache with 30-day expiration
resource "aws_s3_bucket" "bazel_cache" {
  bucket = "bazel-cache"
}

resource "terraform_data" "bazel_cache_lifecycle" {
  input = {
    bucket       = aws_s3_bucket.bazel_cache.id
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

# LLM request/response archive — gzipped JSON envelopes per LLM call.
# Written by packages/llm-observability's LlmArchiveSpanProcessor; one file per
# call, key prefix `llm/<service>/<provider>/YYYY/MM/DD/<traceId>-<spanId>.json.gz`.
# 1-year retention to support cost analysis and prompt regression debugging.
resource "aws_s3_bucket" "llm_archive" {
  bucket = "llm-archive"
}

resource "terraform_data" "llm_archive_lifecycle" {
  input = {
    bucket       = aws_s3_bucket.llm_archive.id
    expire_days  = 365
    endpoint_url = "https://seaweedfs-s3.tailnet-1a49.ts.net"
  }

  provisioner "local-exec" {
    command = <<-EOT
      aws s3api put-bucket-lifecycle-configuration \
        --bucket "${self.input.bucket}" \
        --endpoint-url "${self.input.endpoint_url}" \
        --lifecycle-configuration '{
          "Rules": [{
            "ID": "expire-llm-archives",
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
