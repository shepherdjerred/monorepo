import { Chart, Size } from "cdk8s";
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
        "https://github.com/EssentialsX/Essentials/releases/download/2.21.0/EssentialsX-2.21.0.jar",
        "https://github.com/EssentialsX/Essentials/releases/download/2.21.0/EssentialsXSpawn-2.21.0.jar",
        "https://github.com/dmulloy2/ProtocolLib/releases/download/5.1.0/ProtocolLib.jar",
        "https://github.com/DecentSoftware-eu/DecentHolograms/releases/download/2.8.5/DecentHolograms-2.8.5.jar",
        "https://github.com/garbagemule/MobArena/releases/download/0.108/MobArena-0.108.jar",
      ],

      // TODO: Re-add modrinth plugins when they support 1.21.11:
      // luckperms, towny, coreprotect, worldedit, worldguard, chunky, chunkyborder,
      // plan, placeholderapi, chestsort, multiverse-core, craftbook, levelledmobs
      // Also: mcMMO, DynamicShop, VentureChat, BetterSleeping, LWC, XConomy (Spiget-only)

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
