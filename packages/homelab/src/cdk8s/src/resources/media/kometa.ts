import type { Chart } from "cdk8s";
import {
  KubeConfigMap,
  KubeCronJob,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

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

export function createKometaCronJob(chart: Chart) {
  new KubeConfigMap(chart, "kometa-config", {
    metadata: {
      name: "kometa-config",
    },
    data: {
      "config.yml": KOMETA_CONFIG,
    },
  });

  const plexSecrets = new OnePasswordItem(chart, "kometa-plex-secrets", {
    spec: {
      itemPath: vaultItemPath("xov5k65uwjmm3nfhc7udwmvhny"),
    },
  });

  const kometaCredentials = new OnePasswordItem(chart, "kometa-credentials", {
    spec: {
      itemPath: vaultItemPath("gjrl6xqfupvhwnhgmjsncokiou"),
    },
  });

  new KubeCronJob(chart, "kometa", {
    metadata: {
      name: "kometa",
    },
    spec: {
      schedule: "30 4 * * *",
      timeZone: "America/Los_Angeles",
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 1,
          template: {
            metadata: {
              labels: {
                app: "kometa",
              },
            },
            spec: {
              restartPolicy: "Never",
              securityContext: {
                runAsUser: 1000,
                runAsGroup: 1000,
                runAsNonRoot: true,
                fsGroup: 1000,
                fsGroupChangePolicy: "OnRootMismatch",
                seccompProfile: { type: "RuntimeDefault" },
              },
              containers: [
                {
                  name: "kometa",
                  image: `docker.io/kometateam/kometa:${versions["kometateam/kometa"]}`,
                  args: ["--run"],
                  env: [
                    {
                      name: "TZ",
                      value: "America/Los_Angeles",
                    },
                    {
                      name: "KOMETA_READ_ONLY_CONFIG",
                      value: "true",
                    },
                    {
                      name: "KOMETA_PLEXTOKEN",
                      valueFrom: {
                        secretKeyRef: {
                          name: plexSecrets.name,
                          key: "password",
                        },
                      },
                    },
                    {
                      name: "KOMETA_TMDBAPIKEY",
                      valueFrom: {
                        secretKeyRef: {
                          name: kometaCredentials.name,
                          key: "TMDB_API_KEY",
                        },
                      },
                    },
                  ],
                  resources: {
                    requests: {
                      cpu: Quantity.fromString("50m"),
                      memory: Quantity.fromString("256Mi"),
                    },
                    limits: {
                      cpu: Quantity.fromString("1000m"),
                      memory: Quantity.fromString("1Gi"),
                    },
                  },
                  securityContext: {
                    runAsUser: 1000,
                    runAsGroup: 1000,
                    runAsNonRoot: true,
                    allowPrivilegeEscalation: false,
                    readOnlyRootFilesystem: false,
                    capabilities: {
                      drop: ["ALL"],
                    },
                  },
                  volumeMounts: [
                    {
                      name: "kometa-workdir",
                      mountPath: "/config",
                    },
                    {
                      name: "kometa-config",
                      mountPath: "/config/config.yml",
                      subPath: "config.yml",
                      readOnly: true,
                    },
                  ],
                },
              ],
              volumes: [
                {
                  name: "kometa-workdir",
                  emptyDir: {},
                },
                {
                  name: "kometa-config",
                  configMap: {
                    name: "kometa-config",
                    items: [
                      {
                        key: "config.yml",
                        path: "config.yml",
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  });
}
