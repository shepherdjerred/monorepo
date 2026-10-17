variable "argocd_auth_token" {
  description = "ArgoCD administrator authentication token for managing the Woodpecker and Delivery service accounts"
  type        = string
  sensitive   = true
}
