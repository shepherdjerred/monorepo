variable "tailscale_tailnet" {
  description = "Tailscale tailnet (organization). '-' resolves to the OAuth client's default tailnet."
  type        = string
  default     = "-"
}
