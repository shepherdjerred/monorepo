variable "argocd_auth_token" {
  description = "Operator ArgoCD administrator credential for issuing dedicated Delivery account tokens; never projected into Delivery or CI"
  type        = string
  sensitive   = true
}
