import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import versions from "../../versions.ts";
import { createIngress } from "../../misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "../../misc/cloudflare-tunnel.ts";
import { NVME_STORAGE_CLASS } from "../../misc/storage-classes.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
import {
  DISCORDSRV_PLUGIN_URL,
  getDiscordSrvConfigMapManifest,
  getDiscordSrvExtraVolumes,
  getDiscordSrvExtraEnv,
} from "../../misc/discordsrv-config.ts";
import {
  createMinecraftConfigMaps,
  getMinecraftExtraVolumes,
  getMinecraftExtraEnv,
  getMinecraftPluginConfigInitContainer,
} from "../../misc/minecraft-config.ts";

const NAMESPACE = "minecraft-sjerred";
const SECRET_NAME = "minecraft-sjerred-discord";

export function createMinecraftSjerredApp(chart: Chart) {
  // Create ConfigMaps externally (not in Helm values) to avoid Application size limits
  createMinecraftConfigMaps(chart, "sjerred", NAMESPACE);

  // 1Password secret for DiscordSRV configuration
  // Required fields in 1Password:
  // - discord-bot-token: Discord bot token
  // - discord-channel-id: Main chat channel ID
  // - discord-console-channel-id: (optional) Console channel ID
  // - discord-invite-link: (optional) Discord invite link
  new OnePasswordItem(chart, "minecraft-sjerred-discord-1p", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/q37vet77dfggoqbvu4bqle3gje",
    },
    metadata: {
      name: SECRET_NAME,
      namespace: NAMESPACE,
    },
  });

  createIngress(
    chart,
    "minecraft-sjerred-bluemap-ingress",
    "minecraft-sjerred",
    "minecraft-sjerred-bluemap",
    8100,
    ["minecraft-sjerred-bluemap"],
    true,
  );

  createCloudflareTunnelBinding(chart, "minecraft-sjerred-bluemap-cf-tunnel", {
    serviceName: "minecraft-sjerred-bluemap",
    subdomain: "sjerred.bluemap",
    namespace: "minecraft-sjerred",
  });

  const minecraftValues: HelmValuesForChart<"minecraft"> = {
    // Deploy as StatefulSet for mc-router auto-scaling support
    workloadAsStatefulSet: true,
    strategyType: "RollingUpdate",
    // mc-router annotation for hostname-based routing (must be top-level)
    // Include mc.sjer.red because SRV record redirects there and some clients send that hostname
    serviceAnnotations: {
      "mc-router.itzg.me/externalServerName": "sjer.red,mc.sjer.red",
    },
    image: {
      tag: versions["itzg/minecraft-server"],
    },
    resources: {
      requests: {
        memory: "3Gi",
        cpu: "500m",
      },
      limits: {
        memory: "4Gi",
      },
    },
    minecraftServer: {
      eula: true,
      difficulty: "hard",
      version: versions.paper,
      type: "PAPER",
      motd: "Jerred's Really Cool Minecraft Server",
      // ops: "RiotShielder",
      whitelist: ["RiotShielder", "lolopToaster", "gexboy8", "Virmel"].join(
        ",",
      ),
      spawnProtection: 0,
      viewDistance: 15,
      memory: "3G",
      forcegameMode: true,
      // Use ClusterIP - mc-router handles external routing
      serviceType: "ClusterIP",
      pluginUrls: [
        DISCORDSRV_PLUGIN_URL,
        "https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v5.13/bluemap-5.13-paper.jar",
        "https://cdn.modrinth.com/data/fALzjamp/versions/P3y2MXnd/Chunky-Bukkit-1.4.40.jar",
        // EssentialsX - core commands and teleportation
        "https://cdn.modrinth.com/data/hXiIvTyT/versions/SKQwLLoQ/EssentialsX-2.21.0.jar",
        "https://cdn.modrinth.com/data/sYpvDxGJ/versions/mUsbLYCO/EssentialsXSpawn-2.21.0.jar",
        // Core plugins (all servers)
        "https://cdn.modrinth.com/data/Vebnzrzj/versions/OrIs0S6b/LuckPerms-Bukkit-5.5.17.jar",
        "https://cdn.modrinth.com/data/Lu3KuzdV/versions/HD2IvrxS/CoreProtect-CE-23.1.jar",
        "https://cdn.modrinth.com/data/Kt3eUOUy/versions/Ookvu78B/Sleeper-1.10.4.jar",
        // Harder mobs - scale health/damage based on distance from spawn
        "https://cdn.modrinth.com/data/eX8JZ3Zr/versions/1zP2p3m2/LevelledMobs-4.5.1%20b143.jar",
        // Blood moons - mobs get armor, speed, bigger detection range
        "https://cdn.modrinth.com/data/uA289E2d/versions/F4QSC1D9/Lunamatic-2.0.8-all.jar",
        // Death chests (QoL to offset harder mobs)
        "https://cdn.modrinth.com/data/vCFaodCy/versions/S0aPOt1V/GravesX-4.9.10.10.jar",
      ],
      extraPorts: [
        {
          service: {
            enabled: true,
            port: 8100,
          },
          protocol: "TCP",
          containerPort: 8100,
          name: "bluemap",
          ingress: {
            enabled: false,
          },
        },
      ],
      rcon: {
        enabled: true,
        withGeneratedPassword: true,
      },
    },
    persistence: {
      storageClass: NVME_STORAGE_CLASS,
      // Note: persistence.labels doesn't work in this Helm chart (not templated to VCT)
      // Use Kyverno policy to add velero labels if needed
      dataDir: {
        Size: Size.gibibytes(32).asString(),
        enabled: true,
      },
    },
    // DiscordSRV ConfigMap (main server ConfigMaps are created externally to avoid size limits)
    extraDeploy: [getDiscordSrvConfigMapManifest(NAMESPACE)],

    // Mount configs to /config (itzg syncs to /data on startup)
    // Use split ConfigMaps (true) to match extraDeploy
    extraVolumes: [
      ...getMinecraftExtraVolumes("sjerred", NAMESPACE, true),
      ...getDiscordSrvExtraVolumes(NAMESPACE),
    ],

    // Config sync settings + DiscordSRV secrets
    extraEnv: {
      ...getMinecraftExtraEnv(),
      ...getDiscordSrvExtraEnv(SECRET_NAME),
    },

    // Init container to copy plugin configs (bypasses itzg sync which fails with DirectoryNotEmptyException)
    initContainers: [getMinecraftPluginConfigInitContainer("sjerred", true)],
  };

  // DNS records are now managed by mc-router

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
            "/spec/volumeClaimTemplates",
          ],
        },
        {
          group: "",
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
        automated: {},
        syncOptions: [
          "CreateNamespace=true",
          "ServerSideApply=true",
          "RespectIgnoreDifferences=true",
        ],
      },
    },
  });
}
