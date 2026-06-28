variable "arr_api_keys" {
  description = <<-EOT
    Map of *arr app slug -> REST API key. Keys: radarr, sonarr, prowlarr.
    Because this is a complex (map) type, the CI secret ARR_API_KEYS / local
    TF_VAR_arr_api_keys must be a JSON object string, e.g.
    {"radarr":"...","sonarr":"...","prowlarr":"..."} — a bare single-value
    secret (like the other tokens) will not parse.
  EOT
  type        = map(string)
  sensitive   = true

  validation {
    # Fail fast (with a clear message) if the JSON map is missing a provider
    # key or stored as a bare string. try() keeps the check safe when a key is
    # absent. Without this, a misconfigured ARR_API_KEYS surfaces as an opaque
    # provider/parse error deep in the plan.
    condition = alltrue([
      for slug in ["radarr", "sonarr", "prowlarr"] :
      try(length(var.arr_api_keys[slug]) > 0, false)
    ])
    error_message = "arr_api_keys must be a JSON object with non-empty radarr, sonarr, and prowlarr keys. Set ARR_API_KEYS / TF_VAR_arr_api_keys to a JSON map, e.g. {\"radarr\":\"...\",\"sonarr\":\"...\",\"prowlarr\":\"...\"}."
  }
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by the Dagger container to every stack, unused by *arr resources)"
  type        = string
  sensitive   = true
  default     = ""
}
