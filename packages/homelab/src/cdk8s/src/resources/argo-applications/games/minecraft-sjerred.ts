import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  KubePersistentVolumeClaim,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { BURST_SERVICE_PRIORITY } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { getMinecraftDynmapPort } from "@shepherdjerred/homelab/cdk8s/src/misc/minecraft/minecraft-ports.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import {
  DISCORD_INTEGRATION_MOD_URL,
  getDiscordIntegrationConfigInitContainer,
  getDiscordIntegrationConfigMapManifest,
  getDiscordIntegrationExtraVolumes,
} from "@shepherdjerred/homelab/cdk8s/src/misc/minecraft/discord-integration-config.ts";
import {
  getDynmapConfigInitContainer,
  getDynmapConfigMapManifest,
  getDynmapExtraVolumes,
} from "@shepherdjerred/homelab/cdk8s/src/misc/minecraft/dynmap-config.ts";

const NAMESPACE = "minecraft-sjerred";
const DISCORD_SECRET_NAME = "minecraft-sjerred-discord";
const CURSEFORGE_SECRET_NAME = "minecraft-sjerred-curseforge";
const DATA_PVC_NAME = "minecraft-sjerred-rlcraft-data";
const DYNMAP_MOD_URL =
  "https://github.com/webbukkit/dynmap/releases/download/v3.3-beta-2/Dynmap-3.3-beta-2-forge-1.12.2.jar";

export function createMinecraftSjerredApp(chart: Chart) {
  new KubePersistentVolumeClaim(chart, "minecraft-sjerred-rlcraft-data", {
    metadata: {
      name: DATA_PVC_NAME,
      namespace: NAMESPACE,
      labels: {
        "velero.io/backup": "enabled",
        "velero.io/exclude-from-backup": "false",
      },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: NVME_STORAGE_CLASS,
      resources: { requests: { storage: Quantity.fromString("64Gi") } },
    },
  });

  // Existing Discord bot item. Only the init container receives these fields,
  // and it interpolates them into a writable emptyDir rather than the PVC.
  new OnePasswordItem(chart, "minecraft-sjerred-discord-1p", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/q37vet77dfggoqbvu4bqle3gje",
    },
    metadata: {
      name: DISCORD_SECRET_NAME,
      namespace: NAMESPACE,
    },
  });

  // Existing Minecraft item containing the CurseForge API key.
  new OnePasswordItem(chart, "minecraft-sjerred-curseforge-1p", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/evbgkoazs6dquzlrl5fv7h2gtm",
    },
    metadata: {
      name: CURSEFORGE_SECRET_NAME,
      namespace: NAMESPACE,
    },
  });

  createIngress(chart, "minecraft-sjerred-dynmap-ingress", {
    namespace: NAMESPACE,
    service: "minecraft-sjerred-dynmap",
    port: 8123,
    hosts: ["minecraft-sjerred-dynmap"],
    // The server statefulset hibernates at 0 replicas (mc-router wake-on-join),
    // so a synthetic probe only measures sleep: 60s failures around the clock.
    disableProbe: true,
  });

  createCloudflareTunnelBinding(chart, "minecraft-sjerred-dynmap-cf-tunnel", {
    serviceName: "minecraft-sjerred-dynmap",
    subdomain: "dynmap",
    namespace: NAMESPACE,
    port: 8123,
    // Hibernates at 0 replicas (see above).
    disableProbe: true,
  });

  const minecraftValues: HelmValuesForChart<"minecraft"> = {
    replicaCount: 0,
    // Deploy as StatefulSet for mc-router auto-scaling support
    workloadAsStatefulSet: true,
    extraPodSpec: { priorityClassName: BURST_SERVICE_PRIORITY },
    strategyType: "RollingUpdate",
    // mc-router annotation for hostname-based routing (must be top-level)
    // Include mc.sjer.red because SRV record redirects there and some clients send that hostname
    serviceAnnotations: {
      "mc-router.itzg.me/externalServerName": "sjer.red,mc.sjer.red",
    },
    image: {
      tag: versions["itzg/minecraft-server-java8"],
    },
    resources: {
      requests: {
        memory: "6Gi",
        cpu: "2",
      },
      limits: {
        memory: "8Gi",
      },
    },
    startupProbe: {
      enabled: true,
      failureThreshold: 120,
      periodSeconds: 10,
    },
    minecraftServer: {
      eula: true,
      difficulty: "hard",
      version: "1.12.2",
      type: "AUTO_CURSEFORGE",
      autoCurseForge: {
        apiKey: {
          existingSecret: CURSEFORGE_SECRET_NAME,
          secretKey: "CF_API_KEY",
        },
        slug: "rlcraft",
        fileId: "4612979",
        parallelDownloads: 4,
      },
      motd: "Jerred's RLCraft Server",
      whitelist: [
        "lolopToaster",
        "gexboy8",
        "Virmel",
        "XiguaShuxin",
        "XiguaJerred",
      ].join(","),
      spawnProtection: 0,
      viewDistance: 10,
      memory: "5G",
      gameMode: "survival",
      onlineMode: true,
      maxPlayers: 20,
      forcegameMode: true,
      enableCommandBlock: true,
      announcePlayerAchievements: true,
      maxTickTime: -1,
      overrideServerProperties: true,
      // Use ClusterIP - mc-router handles external routing
      serviceType: "ClusterIP",
      modUrls: [DYNMAP_MOD_URL, DISCORD_INTEGRATION_MOD_URL],
      extraPorts: [getMinecraftDynmapPort()],
      rcon: {
        enabled: true,
        withGeneratedPassword: true,
      },
    },
    persistence: {
      dataDir: {
        enabled: true,
        existingClaim: DATA_PVC_NAME,
      },
    },
    extraDeploy: [
      getDynmapConfigMapManifest(NAMESPACE),
      getDiscordIntegrationConfigMapManifest(NAMESPACE),
    ],
    extraVolumes: [
      ...getDynmapExtraVolumes(NAMESPACE),
      ...getDiscordIntegrationExtraVolumes(NAMESPACE),
    ],
    extraEnv: {
      ALLOW_FLIGHT: "TRUE",
      ENABLE_WHITELIST: "TRUE",
    },
    initContainers: [
      getDynmapConfigInitContainer(),
      getDiscordIntegrationConfigInitContainer(DISCORD_SECRET_NAME),
    ],
  };

  return new Application(chart, "minecraft-sjerred-app", {
    metadata: {
      name: "minecraft-sjerred",
    },
    spec: {
      revisionHistoryLimit: 2,
      project: "default",
      source: {
        repoUrl: "https://itzg.github.io/minecraft-server-charts/",
        targetRevision: versions.minecraft,
        chart: "minecraft",
        helm: {
          valuesObject: minecraftValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "minecraft-sjerred",
      },
      // Allow mc-router to manage replicas for hibernation
      // Ignore Service fields that Kubernetes fills with defaults (chart templates null/empty values)
      ignoreDifferences: [
        {
          group: "apps",
          kind: "StatefulSet",
          jsonPointers: [
            "/spec/replicas",
            "/spec/podManagementPolicy",
            "/spec/revisionHistoryLimit",
            "/spec/persistentVolumeClaimRetentionPolicy",
          ],
        },
        {
          // No `group` — Service is in the core API group. ArgoCD's Application Go
          // types mark `group` as omitempty, so any write through the ArgoCD API
          // drops an explicit "" from the live CR, leaving the apps app-of-apps
          // perpetually OutOfSync against a manifest that includes it.
          kind: "Service",
          jsonPointers: [
            "/spec/clusterIP",
            "/spec/clusterIPs",
            "/spec/ipFamilies",
            "/spec/ipFamilyPolicy",
            "/spec/internalTrafficPolicy",
            "/spec/sessionAffinity",
          ],
        },
      ],
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: [
          "CreateNamespace=true",
          "ServerSideApply=true",
          "RespectIgnoreDifferences=true",
          "ApplyOutOfSyncOnly=true",
        ],
      },
    },
  });
}
