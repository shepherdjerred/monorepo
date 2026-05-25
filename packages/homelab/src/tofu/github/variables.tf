variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by Dagger container, unused by GitHub resources)"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub token used by the GitHub provider for repository and ruleset management"
  type        = string
  sensitive   = true
}
