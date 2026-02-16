variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by Dagger container, unused by GitHub resources)"
  type        = string
  sensitive   = true
}
