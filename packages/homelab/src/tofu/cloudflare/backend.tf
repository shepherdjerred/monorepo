terraform {
  backend "s3" {
    bucket                      = "homelab-tofu-state"
    key                         = "cloudflare/terraform.tfstate"
    # Tailscale funnel instead of Cloudflare tunnel -- CF rewrites Accept-Encoding
    # headers which breaks SigV4 signatures (hashicorp/terraform#36412)
    endpoints                   = { s3 = "https://seaweedfs-s3.tailnet-1a49.ts.net" }
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}
