variable "arr_api_keys" {
  description = "Map of *arr app slug -> REST API key. Keys: radarr, sonarr, prowlarr."
  type        = map(string)
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by the Dagger container to every stack, unused by *arr resources)"
  type        = string
  sensitive   = true
  default     = ""
}
