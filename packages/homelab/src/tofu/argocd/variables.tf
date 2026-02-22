variable "argocd_admin_password" {
  description = "ArgoCD admin password from argocd-initial-admin-secret K8s secret"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by Dagger container, unused by ArgoCD resources)"
  type        = string
  sensitive   = true
}
