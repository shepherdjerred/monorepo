variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by Dagger container, unused by SeaweedFS resources)"
  type        = string
  sensitive   = true
}
