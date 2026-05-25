variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by Dagger container, unused by GitHub resources)"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "Fine-grained GitHub token used by the GitHub provider for repository and ruleset management; classic broad-scope tokens are not allowed"
  type        = string
  sensitive   = true

  validation {
    condition     = startswith(var.github_token, "github_pat_")
    error_message = "github_token must be a fine-grained GitHub personal access token starting with github_pat_; classic broad-scope tokens are not allowed."
  }
}
