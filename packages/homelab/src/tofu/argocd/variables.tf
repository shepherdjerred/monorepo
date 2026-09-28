variable "argocd_auth_token" {
  description = "ArgoCD administrator authentication token for managing the Woodpecker service account"
  type        = string
  sensitive   = true
}
