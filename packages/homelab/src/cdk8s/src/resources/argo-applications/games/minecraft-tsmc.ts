import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { BURST_SERVICE_PRIORITY } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { getMinecraftBlueMapPort } from "@shepherdjerred/homelab/cdk8s/src/misc/minecraft/minecraft-ports.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

const NAMESPACE = "minecraft-tsmc";
const SECRET_NAME = "minecraft-tsmc-discord";

/**
 * The Paper version baked into ghcr.io/shepherdjerred/the-storm-server. The
 * chart's VERSION env overrides the image's, and itzg reads the Paper config
 * defaults from /opt/paper-defaults/<VERSION>, so this must equal the image's
 * Paper (packages/the-storm/server/plugins.json; minecraft-tsmc.test.ts checks
 * it). It deliberately does not follow the catalog's `paper` pin, which moves
 * the other servers.
 */
export const THE_STORM_PAPER_VERSION = "26.2";

/**
 * minecraft-tsmc runs The Storm's own image (packages/the-storm/server): Paper
 * pre-patched, every plugin jar pinned by sha256 and baked in, and the
 * repository-owned config delivered by the image (itzg's /plugins sync plus
 * PATCH_DEFINITIONS). Kubernetes carries only secrets; there are no plugin
 * URLs, config ConfigMaps or copy init containers here.
 */
export function createMinecraftTsmcApp(chart: Chart) {
  // DiscordSRV credentials. Required fields (UPPERCASE_SNAKE labels, matching
  // the env-var refs below): DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID.
  new OnePasswordItem(chart, "minecraft-tsmc-discord-1p", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/yqp25gif2grm5gkg6l44e6vmxy",
    },
    metadata: {
      name: SECRET_NAME,
      namespace: NAMESPACE,
    },
  });

  createIngress(chart, "minecraft-tsmc-bluemap-ingress", {
    namespace: "minecraft-tsmc",
    service: "minecraft-tsmc-bluemap",
    port: 8100,
    hosts: ["minecraft-tsmc-bluemap"],
    proxyClass: "medium",
    // The server statefulset hibernates at 0 replicas (mc-router wake-on-join),
    // so a synthetic probe only measures sleep: 60s failures around the clock.
    disableProbe: true,
  });

  createCloudflareTunnelBinding(chart, "minecraft-tsmc-bluemap-cf-tunnel", {
    serviceName: "minecraft-tsmc-bluemap",
    fqdn: "bluemap.ts-mc.net",
    namespace: "minecraft-tsmc",
    disableDnsUpdates: true,
    port: 8100,
    // Hibernates at 0 replicas (see above); the public probe additionally made
    // cloudflared log an unreachable-origin error every minute.
    disableProbe: true,
  });

  const minecraftValues: HelmValuesForChart<"minecraft"> = {
    replicaCount: 0,
    // Deploy as StatefulSet for mc-router auto-scaling support
    workloadAsStatefulSet: true,
    extraPodSpec: { priorityClassName: BURST_SERVICE_PRIORITY },
    strategyType: "RollingUpdate",
    // mc-router annotation for hostname-based routing (must be top-level)
    // Include mc.ts-mc.net because SRV record redirects there and some clients send that hostname
    serviceAnnotations: {
      "mc-router.itzg.me/externalServerName": "ts-mc.net,mc.ts-mc.net",
    },
    // The chart sets no command or args, so the image's storm-entrypoint runs.
    image: {
      repository: "ghcr.io/shepherdjerred/the-storm-server",
      tag: versions["shepherdjerred/the-storm-server"],
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
    minecraftServer: {
      eula: true,
      difficulty: "hard",
      maxPlayers: 20,
      levelType: "LARGEBIOMES",
      levelSeed: "6723312581398122416",
      viewDistance: 10,
      memory: "6G",
      motd: "The Storm | Survival",
      pvp: true,
      gameMode: "survival",
      forcegameMode: true,
      // Vanilla spawn protection off: the towns module protects spawn with
      // admin regions, and vanilla protection would stop non-ops using the
      // windmill Storm Shards altar.
      spawnProtection: 0,
      ops: "XiguaJerred",
      // TYPE and VERSION repeat the image's own env: the chart always renders
      // TYPE (default VANILLA), and VERSION selects the baked Paper defaults.
      version: THE_STORM_PAPER_VERSION,
      type: "PAPER",
      serviceType: "ClusterIP",
      // The image already sets REMOVE_OLD_MODS=true; plugin jars come only
      // from the image, so /data/plugins/*.jar is exactly the baked set.
      removeOldMods: true,

      extraPorts: [getMinecraftBlueMapPort()],

      rcon: {
        enabled: true,
        withGeneratedPassword: true,
      },
    },
    persistence: {
      storageClass: NVME_STORAGE_CLASS,
      dataDir: {
        Size: Size.gibibytes(128).asString(),
        enabled: true,
      },
    },

    extraEnv: {
      // Kicks idle players after 60 minutes (server.properties
      // player-idle-timeout, formerly set by the synced server.properties).
      PLAYER_IDLE_TIMEOUT: "60",
      // DiscordSRV reads its bot token natively from DISCORDSRV_TOKEN.
      DISCORDSRV_TOKEN: {
        valueFrom: {
          secretKeyRef: { name: SECRET_NAME, key: "DISCORD_BOT_TOKEN" },
        },
      },
      // Interpolated into plugins/DiscordSRV/config.yml by the image's
      // PATCH_DEFINITIONS (server/patches/discordsrv-config.json).
      CFG_DISCORD_CHANNEL_ID: {
        valueFrom: {
          secretKeyRef: { name: SECRET_NAME, key: "DISCORD_CHANNEL_ID" },
        },
      },
    },
  };

  // DNS records are now managed by mc-router

  return new Application(chart, "minecraft-tsmc-app", {
    metadata: {
      name: "minecraft-tsmc",
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
        namespace: "minecraft-tsmc",
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
            "/spec/volumeClaimTemplates",
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
        // ServerSideApply needed to avoid "annotation exceeds 262KB limit" error
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
