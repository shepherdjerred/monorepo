variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by Dagger container, unused by GitHub resources)"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "Fine-grained GitHub token used by the GitHub provider for repository and ruleset management; classic broad-scope tokens are not allowed"
  type        = string
  sensitive   = true
}
