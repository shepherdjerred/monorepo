# Assemble the per-secret variables into the map the resource files index by
# slug (local.arr_api_keys["radarr"], etc.). Keeping this indirection means
# resources.tf / providers.tf don't care how the secrets are transported.
locals {
  arr_api_keys = {
    radarr             = var.radarr_api_key
    sonarr             = var.sonarr_api_key
    prowlarr           = var.prowlarr_api_key
    qbittorrent        = var.qbittorrent_password
    privatehd_password = var.privatehd_password
    privatehd_pid      = var.privatehd_pid
    avistaz_password   = var.avistaz_password
    avistaz_pid        = var.avistaz_pid
    animez_password    = var.animez_password
    animez_pid         = var.animez_pid
  }
}
