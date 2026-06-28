# Managed *arr config (Radarr / Sonarr / Prowlarr), imported from the live
# instances via OpenTofu import blocks + `-generate-config-out`, then verified
# zero-change. Sensitive fields (download-client passwords, application/indexer
# API keys) read back null from the *arr APIs and are intentionally left masked
# here -- they are set in-app and Tofu does not re-send them. Quality profiles
# and custom formats are owned by Recyclarr, NOT this stack. Radarr/Sonarr
# indexers are managed by Prowlarr's application sync and are likewise not here.

# __generated__ by OpenTofu
# Please review these resources and move them into your main configuration files.

# __generated__ by OpenTofu from "1"
resource "radarr_root_folder" "movies" {
  path = "/movies"
}

# __generated__ by OpenTofu from "1"
resource "radarr_download_client" "qbittorrent" {
  add_paused                 = null
  add_stopped                = null
  additional_tags            = []
  api_key                    = null # sensitive
  api_url                    = null
  app_id                     = null
  app_token                  = null # sensitive
  category                   = null
  config_contract            = "QBittorrentSettings"
  destination                = null
  destination_directory      = null
  enable                     = true
  field_tags                 = []
  first_and_last             = false
  host                       = "media-qbittorrent-service"
  implementation             = "QBittorrent"
  initial_state              = 0
  intial_state               = null
  magnet_file_extension      = null
  movie_category             = "radarr"
  movie_directory            = null
  movie_imported_category    = null
  name                       = "qBittorrent"
  nzb_folder                 = null
  older_movie_priority       = 0
  older_priority             = null
  password                   = null # sensitive
  port                       = 8080
  post_import_tags           = []
  priority                   = 1
  protocol                   = "torrent"
  read_only                  = null
  recent_movie_priority      = 0
  recent_priority            = null
  remove_completed_downloads = true
  remove_failed_downloads    = true
  rpc_path                   = null
  save_magnet_files          = null
  secret_token               = null # sensitive
  sequential_order           = false
  start_on_add               = null
  strm_folder                = null
  tags                       = []
  torrent_folder             = null
  url_base                   = null
  use_ssl                    = false
  username                   = "jerred"
  watch_folder               = null
}

# __generated__ by OpenTofu from "1"
resource "sonarr_download_client" "qbittorrent" {
  add_paused                 = null
  add_stopped                = null
  additional_tags            = []
  api_key                    = null # sensitive
  category                   = null
  config_contract            = "QBittorrentSettings"
  destination                = null
  enable                     = true
  field_tags                 = []
  first_and_last             = false
  host                       = "media-qbittorrent-service"
  implementation             = "QBittorrent"
  initial_state              = 0
  intial_state               = null
  magnet_file_extension      = null
  name                       = "qBittorrent"
  nzb_folder                 = null
  older_tv_priority          = 0
  password                   = null # sensitive
  port                       = 8080
  post_import_tags           = []
  priority                   = 1
  protocol                   = "torrent"
  read_only                  = null
  recent_tv_priority         = 0
  remove_completed_downloads = true
  remove_failed_downloads    = true
  rpc_path                   = null
  save_magnet_files          = null
  secret_token               = null # sensitive
  sequential_order           = false
  start_on_add               = null
  strm_folder                = null
  tags                       = []
  torrent_folder             = null
  tv_category                = "tv-sonarr"
  tv_directory               = null
  tv_imported_category       = null
  url_base                   = null
  use_ssl                    = false
  username                   = "jerred"
  watch_folder               = null
}

# __generated__ by OpenTofu from "1"
resource "sonarr_root_folder" "tv" {
  path = "/tv"
}

# __generated__ by OpenTofu from "2"
resource "prowlarr_application" "sonarr" {
  anime_sync_categories = [5070]
  api_key               = null # sensitive
  base_url              = "http://media-sonarr-service:8989"
  config_contract       = "SonarrSettings"
  implementation        = "Sonarr"
  name                  = "Sonarr"
  prowlarr_url          = "http://media-prowlarr-service:9696"
  sync_categories       = [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5090]
  sync_level            = "fullSync"
  tags                  = []
}

# __generated__ by OpenTofu from "1"
resource "prowlarr_application" "radarr" {
  anime_sync_categories = []
  api_key               = null # sensitive
  base_url              = "http://media-radarr-service:7878"
  config_contract       = "RadarrSettings"
  implementation        = "Radarr"
  name                  = "Radarr"
  prowlarr_url          = "http://media-prowlarr-service:9696"
  sync_categories       = [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080, 2090]
  sync_level            = "fullSync"
  tags                  = []
}

# __generated__ by OpenTofu from "6"
resource "prowlarr_indexer" "knaben" {
  app_profile_id  = 1
  config_contract = "NoAuthTorrentBaseSettings"
  enable          = true
  fields = [
    {
      bool_value      = false
      name            = "torrentBaseSettings.preferMagnetUrl"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = null
      name            = "baseSettings.limitsUnit"
      number_value    = 0
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
  ]
  implementation = "Knaben"
  name           = "Knaben"
  priority       = 25
  protocol       = "torrent"
  tags           = []
}

# __generated__ by OpenTofu from "7"
resource "prowlarr_indexer" "magnetdownload" {
  app_profile_id  = 1
  config_contract = "CardigannSettings"
  enable          = true
  fields = [
    {
      bool_value      = false
      name            = "torrentBaseSettings.preferMagnetUrl"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = null
      name            = "baseSettings.limitsUnit"
      number_value    = 0
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = null
      name            = "definitionFile"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = "magnetdownload"
    },
    {
      bool_value      = null
      name            = "info_category_8000"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = "MagnetDownload does not return categories in its search results. To sync to your apps, include 8000(Other) in your Apps' Sync Categories."
    },
  ]
  implementation = "Cardigann"
  name           = "MagnetDownload"
  priority       = 25
  protocol       = "torrent"
  tags           = []
}

# __generated__ by OpenTofu from "1"
resource "prowlarr_download_client" "qbittorrent" {
  add_paused      = null
  add_stopped     = null
  additional_tags = []
  api_key         = null # sensitive
  api_url         = null
  app_id          = null
  app_token       = null # sensitive
  categories = [
  ]
  category              = "prowlarr"
  config_contract       = "QBittorrentSettings"
  destination           = null
  destination_directory = null
  directory             = null
  enable                = true
  field_tags            = []
  host                  = "media-qbittorrent-service"
  implementation        = "QBittorrent"
  initial_state         = 0
  intial_state          = null
  item_priority         = 0
  magnet_file_extension = null
  name                  = "qBittorrent"
  nzb_folder            = null
  password              = null # sensitive
  port                  = 8080
  post_im_tags          = []
  priority              = 1
  protocol              = "torrent"
  read_only             = null
  rpc_path              = null
  save_magnet_files     = null
  secret_token          = null # sensitive
  start_on_add          = null
  station_directory     = null
  strm_folder           = null
  tags                  = []
  torrent_folder        = null
  tv_imported_category  = null
  url_base              = null
  use_ssl               = false
  username              = "jerred"
}

# __generated__ by OpenTofu from "3"
resource "prowlarr_indexer" "the_pirate_bay" {
  app_profile_id  = 1
  config_contract = "CardigannSettings"
  enable          = true
  fields = [
    {
      bool_value      = false
      name            = "torrentBaseSettings.preferMagnetUrl"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = null
      name            = "apiurl"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = "apibay.org"
    },
    {
      bool_value      = null
      name            = "baseSettings.limitsUnit"
      number_value    = 0
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = null
      name            = "definitionFile"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = "thepiratebay"
    },
    {
      bool_value      = null
      name            = "info_uploader"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = "You can filter by Uploader by entering a Case Sensitive username, or leave empty to get all results.<br>Note: this is the username of the Uploader and not the Groupname that often show up at the end of TPB titles, eg -MeGusta."
    },
    {
      bool_value      = null
      name            = "uploader"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = ""
    },
  ]
  implementation = "Cardigann"
  name           = "The Pirate Bay"
  priority       = 25
  protocol       = "torrent"
  tags           = []
}

# __generated__ by OpenTofu from "5"
resource "prowlarr_indexer" "privatehd" {
  app_profile_id  = 1
  config_contract = "AvistazSettings"
  enable          = true
  fields = [
    {
      bool_value      = false
      name            = "freeleechOnly"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = false
      name            = "torrentBaseSettings.preferMagnetUrl"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = null
      name            = "baseSettings.limitsUnit"
      number_value    = 0
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = null
      name            = "baseUrl"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = "https://privatehd.to/"
    },
    {
      bool_value      = null
      name            = "password"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = null
      name            = "pid"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = null
      name            = "torrentBaseSettings.seedRatio"
      number_value    = 3
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = null
    },
    {
      bool_value      = null
      name            = "username"
      number_value    = null
      sensitive_value = null # sensitive
      set_value       = null
      text_value      = "root@sjer.red"
    },
  ]
  implementation = "PrivateHD"
  name           = "PrivateHD"
  priority       = 1
  protocol       = "torrent"
  tags           = []
}
