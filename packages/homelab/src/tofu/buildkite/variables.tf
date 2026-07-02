variable "buildkite_api_token" {
  description = "Buildkite API access token (REST read_pipelines/write_pipelines + GraphQL) used to manage the cluster, queue, and pipeline"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by the Dagger container to every stack, unused by Buildkite resources)"
  type        = string
  sensitive   = true
  default     = ""
}
