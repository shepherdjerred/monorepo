import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { BURST_SERVICE_PRIORITY } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { getMinecraftBlueMapPort } from "@shepherdjerred/homelab/cdk8s/src/misc/minecraft/minecraft-ports.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import {
  MINING_RESET_IMAGE_ANNOTATION,
  MINING_RESET_LOCK_ANNOTATION,
} from "@shepherdjerred/homelab/cdk8s/src/resources/minecraft-mining-reset-guard.ts";

const NAMESPACE = "minecraft-tsmc";
const SECRET_NAME = "minecraft-tsmc-discord";
const RCON_SECRET_NAME = "minecraft-tsmc-brain";
const BRAIN_SECRET_NAME = "minecraft-tsmc-storm-brain";
// MCBridge agent API (packages/the-storm/plugin/bridge); port-forward only.
const MC_BRIDGE_PORT = 25_580;

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
  // The Storm bridge credentials. Required fields (UPPERCASE_SNAKE labels, matching
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

  new OnePasswordItem(chart, "minecraft-tsmc-brain-1p", {
    spec: { itemPath: vaultItemPath("mpv7cti3fpwrfobgr6ydnemydy") },
    metadata: { name: RCON_SECRET_NAME, namespace: NAMESPACE },
  });

  // The agent reads the same owner-managed brain bearer token from its own
  // namespace; Kubernetes secrets cannot cross namespace boundaries.
  new OnePasswordItem(chart, "minecraft-tsmc-storm-brain-1p", {
    spec: { itemPath: vaultItemPath("storm-brain") },
    metadata: { name: BRAIN_SECRET_NAME, namespace: NAMESPACE },
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
      // Candidate publication must not activate an unprepared production volume.
      tag: versions["shepherdjerred/the-storm-server/prod"],
    },
    // Sized for the Search and Destroy world: up to ~100 ticking Citizens bot
    // players share this server with survival, so the heap and the CPU
    // reservation grew with it. CPU stays unlimited so bursts are not throttled.
    resources: {
      requests: {
        memory: "8Gi",
        cpu: "4",
      },
      limits: {
        memory: "10Gi",
      },
    },
    minecraftServer: {
      eula: true,
      difficulty: "hard",
      maxPlayers: 20,
      levelType: "LARGEBIOMES",
      levelSeed: "6723312581398122416",
      viewDistance: 10,
      memory: "8G",
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
      // The Storm owns gameplay and locks; the image retires every stale jar.
      removeOldMods: true,

      extraPorts: [
        getMinecraftBlueMapPort(),
        {
          // mc-router handles Java TCP only. Bedrock UDP reaches Geyser while
          // the server is awake; a Bedrock packet cannot wake this StatefulSet.
          service: {
            enabled: true,
            type: "NodePort",
            port: 19_132,
            nodePort: 30_004,
          },
          protocol: "UDP",
          containerPort: 19_132,
          name: "bedrock",
          ingress: { enabled: false },
        },
        {
          // MCBridge (mc-harness agent API). No Service or ingress: agents
          // reach it only through `kubectl port-forward` with the bearer token.
          service: { enabled: false, port: MC_BRIDGE_PORT },
          protocol: "TCP",
          containerPort: MC_BRIDGE_PORT,
          name: "bridge",
          ingress: { enabled: false },
        },
      ],

      rcon: {
        enabled: true,
        withGeneratedPassword: false,
        existingSecret: RCON_SECRET_NAME,
        secretKey: "MINECRAFT_RCON_PASSWORD",
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
      FLIPT_URL: "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
      FLIPT_ENVIRONMENT: "prod",
      // Kicks idle players after 60 minutes (server.properties
      // player-idle-timeout, formerly set by the synced server.properties).
      PLAYER_IDLE_TIMEOUT: "60",
      STORM_BRAIN_BEARER_TOKEN: {
        valueFrom: {
          secretKeyRef: {
            name: BRAIN_SECRET_NAME,
            key: "STORM_BRAIN_BEARER_TOKEN",
          },
        },
      },
      // MCBridge disables itself without this token; same storm-brain item.
      MC_BRIDGE_TOKEN: {
        valueFrom: {
          secretKeyRef: { name: BRAIN_SECRET_NAME, key: "MC_BRIDGE_TOKEN" },
        },
      },
      MC_BRIDGE_BIND: "0.0.0.0",
      DISCORD_BOT_TOKEN: {
        valueFrom: {
          secretKeyRef: { name: SECRET_NAME, key: "DISCORD_BOT_TOKEN" },
        },
      },
      DISCORD_CHANNEL_ID: {
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
            `/metadata/annotations/${MINING_RESET_LOCK_ANNOTATION.replaceAll("/", "~1")}`,
            `/metadata/annotations/${MINING_RESET_IMAGE_ANNOTATION.replaceAll("/", "~1")}`,
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
            "/metadata/annotations/mc-router.itzg.me~1autoScaleUp",
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
