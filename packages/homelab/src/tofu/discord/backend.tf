terraform {
  backend "s3" {
    bucket                      = "homelab-tofu-state"
    key                         = "discord/terraform.tfstate"
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
