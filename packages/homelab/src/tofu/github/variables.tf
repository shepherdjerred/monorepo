variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed to every stack, unused by GitHub resources)"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub token used by the GitHub provider for repository and ruleset management"
  type        = string
  sensitive   = true

  validation {
    condition = anytrue([
      for prefix in ["github_pat_", "ghp_", "ghs_", "ghu_"] :
      startswith(var.github_token, prefix)
    ])
    error_message = "github_token must be a GitHub fine-grained PAT (github_pat_), classic PAT (ghp_), GitHub App installation token (ghs_), or GitHub App user token (ghu_)."
  }
}
