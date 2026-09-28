variable "argocd_auth_token" {
  description = "ArgoCD administrator authentication token for managing the Woodpecker service account"
  type        = string
  sensitive   = true
}
variable "op_connect_url" {
  description = "1Password Connect server URL"
  type        = string
  default     = "http://localhost:8080"
}
