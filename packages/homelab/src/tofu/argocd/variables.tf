variable "argocd_auth_token" {
  description = "ArgoCD authentication token from the Buildkite 1Password secret"
  type        = string
  sensitive   = true
}
variable "op_connect_url" {
  description = "1Password Connect server URL"
  type        = string
  default     = "http://localhost:8080"
}
