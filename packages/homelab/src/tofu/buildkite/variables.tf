variable "buildkite_api_token" {
  description = "Buildkite API access token (REST read_pipelines/write_pipelines + GraphQL) used to manage the cluster, queue, and pipeline"
  type        = string
  sensitive   = true
}
