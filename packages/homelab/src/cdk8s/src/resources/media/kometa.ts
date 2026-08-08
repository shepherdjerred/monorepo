import type { Chart } from "cdk8s";
import { KubeConfigMap } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

const KOMETA_CONFIG = `libraries:
  Movies:
    collection_files:
      - default: basic
      - default: imdb
      - default: tmdb
    overlay_files:
      - default: resolution
      - default: audio_codec
      - default: ratings
  TV Shows:
    collection_files:
      - default: basic
      - default: imdb
      - default: tmdb
    overlay_files:
      - default: resolution
      - default: audio_codec
      - default: ratings

settings:
  cache: true
  cache_expiration: 60
  asset_directory: config/assets
  sync_mode: sync
  show_missing_season_assets: false
  show_missing_episode_assets: false
  show_options: false

plex:
  url: http://media-plex-service:32400
  token: <<plextoken>>

tmdb:
  apikey: <<tmdbapikey>>
  language: en
`;

export function createKometaResources(chart: Chart) {
  new KubeConfigMap(chart, "kometa-config", {
    metadata: {
      name: "kometa-config",
    },
    data: {
      "config.yml": KOMETA_CONFIG,
    },
  });

  new OnePasswordItem(chart, "kometa-plex-secrets", {
    metadata: { name: "kometa-plex-secrets" },
    spec: {
      itemPath: vaultItemPath("xov5k65uwjmm3nfhc7udwmvhny"),
    },
  });

  new OnePasswordItem(chart, "kometa-credentials", {
    metadata: { name: "kometa-credentials" },
    spec: {
      itemPath: vaultItemPath("gjrl6xqfupvhwnhgmjsncokiou"),
    },
  });
}
