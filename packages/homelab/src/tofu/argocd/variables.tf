variable "argocd_auth_token" {
  description = "Token of the tofu-argocd ArgoCD account, which may only read and issue tokens for the Delivery accounts this stack mints"
  type        = string
  sensitive   = true
}
