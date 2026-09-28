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

variable "required_ci_status_context" {
  description = "Required PR CI context; use the Buildkite context only for the targeted premerge ruleset bypass apply"
  type        = string
  default     = "ci/woodpecker/pr/ci-complete"

  validation {
    condition = contains([
      "buildkite/monorepo/pr",
      "ci/woodpecker/pr/ci-complete",
    ], var.required_ci_status_context)
    error_message = "required_ci_status_context must be the Buildkite bootstrap context or the Woodpecker CI completion context."
  }
}
