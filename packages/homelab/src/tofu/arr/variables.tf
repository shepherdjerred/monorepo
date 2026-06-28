variable "arr_api_keys" {
  description = <<-EOT
    JSON object string of the secrets this stack needs, e.g.
    {"radarr":"...","sonarr":"...","prowlarr":"...","qbittorrent":"..."}.
    radarr/sonarr/prowlarr are the *arr REST API keys (provider auth +
    Prowlarr application sync); qbittorrent is the qBittorrent WebUI password
    used by the Radarr/Sonarr/Prowlarr download clients. Declared as a raw
    string (not map(string)) on purpose: a map-typed variable is HCL-decoded
    from ARR_API_KEYS / TF_VAR_arr_api_keys *before* validation runs, so a
    malformed bare-string secret fails with an opaque "Variables not allowed"
    error before the friendly validation below can fire. Taking it as a string
    lets the validation catch the bad shape; locals.tf jsondecode()s it.
  EOT
  type        = string
  sensitive   = true

  validation {
    # Runs before locals.tf decodes the value, because a string var accepts the
    # raw secret verbatim (no pre-validation type decode). can(jsondecode(...))
    # turns a non-JSON secret into a clean failure; the alltrue() with try()
    # also rejects valid-but-wrong-shape JSON (array, scalar, or missing key).
    condition = can(jsondecode(var.arr_api_keys)) && alltrue([
      for slug in ["radarr", "sonarr", "prowlarr", "qbittorrent"] :
      try(length(jsondecode(var.arr_api_keys)[slug]) > 0, false)
    ])
    error_message = "ARR_API_KEYS / TF_VAR_arr_api_keys must be a JSON object string with non-empty radarr, sonarr, prowlarr, and qbittorrent keys, e.g. {\"radarr\":\"...\",\"sonarr\":\"...\",\"prowlarr\":\"...\",\"qbittorrent\":\"...\"}."
  }
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (passed by the Dagger container to every stack, unused by *arr resources)"
  type        = string
  sensitive   = true
  default     = ""
}
