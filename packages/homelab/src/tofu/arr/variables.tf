# Per-secret variables (one CI secret / 1Password field each). locals.tf
# assembles them into local.arr_api_keys so the resource files stay unchanged.
# Each is fail-fast validated non-empty: a missing/blank CI secret should error
# clearly here rather than deep in a provider call.

variable "radarr_api_key" {
  description = "Radarr REST API key (provider auth + Prowlarr application sync)."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.radarr_api_key) > 0
    error_message = "radarr_api_key must be non-empty (set RADARR_API_KEY / TF_VAR_radarr_api_key)."
  }
}

variable "sonarr_api_key" {
  description = "Sonarr REST API key (provider auth + Prowlarr application sync)."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.sonarr_api_key) > 0
    error_message = "sonarr_api_key must be non-empty (set SONARR_API_KEY / TF_VAR_sonarr_api_key)."
  }
}

variable "prowlarr_api_key" {
  description = "Prowlarr REST API key (provider auth)."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.prowlarr_api_key) > 0
    error_message = "prowlarr_api_key must be non-empty (set PROWLARR_API_KEY / TF_VAR_prowlarr_api_key)."
  }
}

variable "qbittorrent_password" {
  description = "qBittorrent WebUI password (user \"jerred\") used by the Radarr/Sonarr/Prowlarr download clients."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.qbittorrent_password) > 0
    error_message = "qbittorrent_password must be non-empty (set QBITTORRENT_PASSWORD / TF_VAR_qbittorrent_password)."
  }
}

variable "privatehd_password" {
  description = "PrivateHD account password for the Prowlarr PrivateHD indexer."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.privatehd_password) > 0
    error_message = "privatehd_password must be non-empty (set PRIVATEHD_PASSWORD / TF_VAR_privatehd_password)."
  }
}

variable "privatehd_pid" {
  description = "PrivateHD PID (AvisTaz per-user token) for the Prowlarr PrivateHD indexer."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.privatehd_pid) > 0
    error_message = "privatehd_pid must be non-empty (set PRIVATEHD_PID / TF_VAR_privatehd_pid)."
  }
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed to every stack, unused by *arr resources)"
  type        = string
  sensitive   = true
  default     = ""
}
