variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed to every stack, unused by SeaweedFS resources)"
  type        = string
  sensitive   = true
}
