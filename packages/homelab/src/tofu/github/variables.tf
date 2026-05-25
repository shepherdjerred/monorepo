variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by Dagger container, unused by GitHub resources)"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub token used by the GitHub provider for repository and ruleset management"
  type        = string
  sensitive   = true

  validation {
    condition = anytrue([
      for prefix in ["github_pat_", "ghp_", "ghs_"] :
      startswith(var.github_token, prefix)
    ])
    error_message = "github_token must be a GitHub fine-grained PAT, classic PAT, or GitHub App installation token."
  }
}
