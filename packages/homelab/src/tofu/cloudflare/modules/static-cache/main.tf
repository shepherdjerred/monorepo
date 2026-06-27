terraform {
  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
    }
  }
}

variable "zone_id" {
  type        = string
  description = "Cloudflare zone ID to apply the static-asset cache config to."
}

variable "asset_prefixes" {
  type        = list(string)
  description = <<-EOT
    URL path prefixes (leading slash, e.g. "/_astro/", "/app/assets/") that hold
    content-hashed, fingerprinted assets. The deploy uploads these with a 1-year
    `immutable` Cache-Control as S3 object metadata; this rule tells Cloudflare to
    respect that origin header for both edge and browser caching, scoped to these
    prefixes so the rest of the zone is untouched.
  EOT
  validation {
    condition     = length(var.asset_prefixes) > 0
    error_message = "asset_prefixes must contain at least one prefix."
  }
}

# Cache content-hashed assets per their origin Cache-Control (immutable, 1 year).
# `respect_origin` for edge AND browser TTL means the immutable directive reaches
# browsers (Cloudflare's default zone Browser Cache TTL would otherwise clamp it),
# but only for these hashed prefixes — mutable shells/HTML elsewhere keep their
# `no-cache` behavior. Serve-stale-while-revalidating shields users from the
# single-replica SeaweedFS/Caddy origin's intermittent blips.
resource "cloudflare_ruleset" "static_asset_cache" {
  zone_id = var.zone_id
  name    = "static-asset-cache"
  kind    = "zone"
  phase   = "http_request_cache_settings"

  rules = [{
    ref         = "immutable_hashed_assets"
    description = "Respect origin Cache-Control for content-hashed assets"
    expression = join(" or ", [
      for prefix in var.asset_prefixes :
      "starts_with(http.request.uri.path, \"${prefix}\")"
    ])
    action = "set_cache_settings"
    action_parameters = {
      cache       = true
      edge_ttl    = { mode = "respect_origin" }
      browser_ttl = { mode = "respect_origin" }
      serve_stale = { disable_stale_while_updating = false }
    }
  }]
}

# Smart Tiered Cache: funnel cache-misses through an upper tier rather than every
# edge hitting origin directly — raises hit ratio and shields the origin.
resource "cloudflare_tiered_cache" "smart" {
  zone_id = var.zone_id
  value   = "on"
}
