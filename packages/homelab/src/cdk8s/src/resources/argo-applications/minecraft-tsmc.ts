import type { Chart} from "cdk8s";
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

const NAMESPACE = "minecraft-tsmc";
const SECRET_NAME = "minecraft-tsmc-discord";

export function createMinecraftTsmcApp(chart: Chart) {
  // Create ConfigMaps externally (not in Helm values) to avoid Application size limits
  createMinecraftConfigMaps(chart, "tsmc", NAMESPACE);

  // 1Password secret for DiscordSRV configuration
  // Required fields in 1Password:
  // - discord-bot-token: Discord bot token
  // - discord-channel-id: Main chat channel ID
  // - discord-console-channel-id: (optional) Console channel ID
  // - discord-invite-link: (optional) Discord invite link
  new OnePasswordItem(chart, "minecraft-tsmc-discord-1p", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/yqp25gif2grm5gkg6l44e6vmxy",
    },
    metadata: {
      name: SECRET_NAME,
      namespace: NAMESPACE,
    },
  });

  createIngress(
    chart,
    "minecraft-tsmc-bluemap-ingress",
    "minecraft-tsmc",
    "minecraft-tsmc-bluemap",
    8100,
    ["minecraft-tsmc-bluemap"],
    true,
  );

  createCloudflareTunnelBinding(chart, "minecraft-tsmc-bluemap-cf-tunnel", {
    serviceName: "minecraft-tsmc-bluemap",
    fqdn: "bluemap.ts-mc.net",
    namespace: "minecraft-tsmc",
    disableDnsUpdates: true,
  });

  const minecraftValues: HelmValuesForChart<"minecraft"> = {
    // Deploy as StatefulSet for mc-router auto-scaling support
    workloadAsStatefulSet: true,
    strategyType: "RollingUpdate",
    // mc-router annotation for hostname-based routing (must be top-level)
    // Include mc.ts-mc.net because SRV record redirects there and some clients send that hostname
    serviceAnnotations: {
      "mc-router.itzg.me/externalServerName": "ts-mc.net,mc.ts-mc.net",
    },
    image: {
      tag: versions["itzg/minecraft-server"],
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
      spawnProtection: 0,
      ops: "RiotShielder",
      version: versions.paper,
      type: "PAPER",
      serviceType: "ClusterIP",

      // Plugin downloads - direct URLs
      pluginUrls: [
        "https://github.com/MilkBowl/Vault/releases/download/1.7.3/Vault.jar",
        "https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v5.13/bluemap-5.13-paper.jar",
        DISCORDSRV_PLUGIN_URL,
        "https://cdn.modrinth.com/data/hXiIvTyT/versions/SKQwLLoQ/EssentialsX-2.21.0.jar",
        "https://cdn.modrinth.com/data/sYpvDxGJ/versions/mUsbLYCO/EssentialsXSpawn-2.21.0.jar",
        "https://github.com/dmulloy2/ProtocolLib/releases/download/5.1.0/ProtocolLib.jar",
        "https://github.com/DecentSoftware-eu/DecentHolograms/releases/download/2.8.5/DecentHolograms-2.8.5.jar",
        "https://github.com/garbagemule/MobArena/releases/download/0.108/MobArena-0.108.jar",
        // Core plugins (all servers)
        "https://cdn.modrinth.com/data/Vebnzrzj/versions/OrIs0S6b/LuckPerms-Bukkit-5.5.17.jar",
        "https://cdn.modrinth.com/data/Lu3KuzdV/versions/HD2IvrxS/CoreProtect-CE-23.1.jar",
        "https://cdn.modrinth.com/data/Kt3eUOUy/versions/Ookvu78B/Sleeper-1.10.4.jar",
        // Re-enabled paused plugins (confirmed 1.21.4 compatible)
        "https://cdn.modrinth.com/data/Vs77PB2W/versions/jyDT9BfO/Towny-0.102.0.0.jar",
        "https://cdn.modrinth.com/data/1u6JkXh5/versions/CkT32vix/worldedit-bukkit-7.4.0.jar",
        "https://cdn.modrinth.com/data/DKY9btbd/versions/f9NoeotB/worldguard-bukkit-7.0.13-dist.jar",
        "https://cdn.modrinth.com/data/fALzjamp/versions/P3y2MXnd/Chunky-Bukkit-1.4.40.jar",
        "https://cdn.modrinth.com/data/s86X568j/versions/asaBBItO/ChunkyBorder-Bukkit-1.2.23.jar",
        "https://cdn.modrinth.com/data/wJQfHhxh/versions/teRNK6V9/Plan-5.6-build-2965.jar",
        "https://cdn.modrinth.com/data/lKEzGugV/versions/UmbIiI5H/PlaceholderAPI-2.12.2.jar",
        "https://cdn.modrinth.com/data/LDkz4P10/versions/jOP2uPPT/ChestSort-1.1.jar",
        "https://cdn.modrinth.com/data/3wmN97b8/versions/H3obfDHQ/multiverse-core-5.5.2.jar",
        "https://cdn.modrinth.com/data/jrO7z7l7/versions/KiMQgPhT/craftbook-bukkit-5.0.0-beta-04.jar",
        "https://cdn.modrinth.com/data/eX8JZ3Zr/versions/1zP2p3m2/LevelledMobs-4.5.1%20b143.jar",
        "https://cdn.modrinth.com/data/OzSmbRQS/versions/dL7LlZic/DynamicShop-2.3.1.jar",
        "https://github.com/Aust1n46/VentureChat/releases/download/v3.8.0/VentureChat-3.8.0.jar",
        "https://github.com/YiC200333/XConomy/releases/download/2.26.3/XConomy-Paper-2.26.3.jar",
        // New SMP plugins
        "https://cdn.modrinth.com/data/LI8sodAD/versions/pKwKVSKo/CombatLog.jar",
        "https://cdn.modrinth.com/data/vCFaodCy/versions/S0aPOt1V/GravesX-4.9.10.10.jar",
        "https://cdn.modrinth.com/data/uA289E2d/versions/F4QSC1D9/Lunamatic-2.0.8-all.jar",
      ],
      // Skipped (no direct download URL): mcMMO (Spigot/Polymart only), LWCX (Spigot only)

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
        Size: Size.gibibytes(128).asString(),
        enabled: true,
      },
    },

    // DiscordSRV ConfigMap (main server ConfigMaps are created externally to avoid size limits)
    extraDeploy: [getDiscordSrvConfigMapManifest(NAMESPACE)],

    // Mount configs to /config (itzg syncs to /data on startup)
    // Use split ConfigMaps (true) to avoid Application size limits
    extraVolumes: [...getMinecraftExtraVolumes("tsmc", NAMESPACE, true), ...getDiscordSrvExtraVolumes(NAMESPACE)],

    // Config sync settings + DiscordSRV secrets
    extraEnv: {
      ...getMinecraftExtraEnv(),
      ...getDiscordSrvExtraEnv(SECRET_NAME),
    },

    // Init container to copy plugin configs (bypasses itzg sync which fails with DirectoryNotEmptyException)
    initContainers: [getMinecraftPluginConfigInitContainer("tsmc", true)],
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
        // ServerSideApply needed to avoid "annotation exceeds 262KB limit" error
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true", "RespectIgnoreDifferences=true"],
      },
    },
  });
}
