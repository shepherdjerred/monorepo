import type { Chart} from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import { createIngress } from "../../misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "../../misc/cloudflare-tunnel.ts";
import { NVME_STORAGE_CLASS } from "../../misc/storage-classes.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
import {
  createMinecraftConfigMaps,
  getMinecraftExtraVolumes,
  getMinecraftExtraEnv,
  getMinecraftPluginConfigInitContainer,
} from "../../misc/minecraft-config.ts";

const NAMESPACE = "minecraft-shuxin";

export function createMinecraftShuxinApp(chart: Chart) {
  // Create ConfigMaps externally (not in Helm values) to avoid Application size limits
  createMinecraftConfigMaps(chart, "shuxin", NAMESPACE);

  createIngress(
    chart,
    "minecraft-shuxin-bluemap-ingress",
    "minecraft-shuxin",
    "minecraft-shuxin-bluemap",
    8100,
    ["minecraft-shuxin-bluemap"],
    true,
  );

  createCloudflareTunnelBinding(chart, "minecraft-shuxin-bluemap-cf-tunnel", {
    serviceName: "minecraft-shuxin-bluemap",
    subdomain: "shuxin.bluemap",
    namespace: "minecraft-shuxin",
  });

  const minecraftValues: HelmValuesForChart<"minecraft"> = {
    // Deploy as StatefulSet for mc-router auto-scaling support
    workloadAsStatefulSet: true,
    strategyType: "RollingUpdate",
    // mc-router annotation for hostname-based routing (must be top-level)
    serviceAnnotations: {
      "mc-router.itzg.me/externalServerName": "shuxin.sjer.red",
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
      difficulty: "easy",
      version: versions.paper,
      type: "PAPER",
      motd: "Jerred & Shuxin",
      whitelist: ["RiotShielder", "vietnamesechovy"].join(","),
      spawnProtection: 0,
      viewDistance: 15,
      memory: "3G",
      forcegameMode: true,
      // Use ClusterIP - mc-router handles external routing for Java Edition
      serviceType: "ClusterIP",
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
        {
          // Bedrock port (UDP) - mc-router doesn't support UDP, so this needs NodePort
          // Note: Bedrock clients can only connect when server is running
          // Java clients connecting via mc-router will wake the server
          service: {
            enabled: true,
            type: "NodePort",
            port: 19_132,
            nodePort: 30_003,
          },
          protocol: "UDP",
          containerPort: 19_132,
          name: "bedrock",
          ingress: {
            enabled: false,
          },
        },
      ],
      pluginUrls: [
        "https://github.com/MilkBowl/Vault/releases/download/1.7.3/Vault.jar",
        "https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v5.13/bluemap-5.13-paper.jar",
        "https://cdn.modrinth.com/data/fALzjamp/versions/P3y2MXnd/Chunky-Bukkit-1.4.40.jar",
        "https://github.com/EssentialsX/Essentials/releases/download/2.21.2/EssentialsX-2.21.2.jar",
        "https://github.com/EssentialsX/Essentials/releases/download/2.21.2/EssentialsXSpawn-2.21.2.jar",
        "https://cdn.modrinth.com/data/lKEzGugV/versions/vkuwyUC6/PlaceholderAPI-2.11.6.jar",
        // GeyserMC - allows Bedrock Edition (Switch, mobile, etc.) to connect
        "https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot",
        // Floodgate - allows Bedrock players to join with Xbox accounts
        "https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot",
        // ProtocolLib - packet manipulation library (dependency for some plugins)
        "https://github.com/dmulloy2/ProtocolLib/releases/download/5.4.0/ProtocolLib.jar",
        // DecentHolograms - hologram display plugin
        "https://github.com/DecentSoftware-eu/DecentHolograms/releases/download/2.9.9/DecentHolograms-2.9.9.jar",
        // Core plugins (all servers)
        "https://cdn.modrinth.com/data/Vebnzrzj/versions/OrIs0S6b/LuckPerms-Bukkit-5.5.17.jar",
        "https://cdn.modrinth.com/data/Lu3KuzdV/versions/HD2IvrxS/CoreProtect-CE-23.1.jar",
        "https://cdn.modrinth.com/data/Kt3eUOUy/versions/Ookvu78B/Sleeper-1.10.4.jar",
        // Easier mobs - challenge-bronze preset reduces mob health/damage
        "https://cdn.modrinth.com/data/eX8JZ3Zr/versions/1zP2p3m2/LevelledMobs-4.5.1%20b143.jar",
        // Death chests - items saved at death location instead of scattering
        "https://cdn.modrinth.com/data/vCFaodCy/versions/S0aPOt1V/GravesX-4.9.10.10.jar",
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
    // ConfigMaps are created externally to avoid Application size limits (etcd request too large)

    // Mount configs to /config (itzg syncs to /data on startup)
    // Use split ConfigMaps (true) to avoid annotation size limits
    extraVolumes: getMinecraftExtraVolumes("shuxin", NAMESPACE, true),

    // Config sync settings
    extraEnv: {
      ...getMinecraftExtraEnv(),
      VERSION_FROM_MODRINTH_PROJECTS: "true",
    },

    // Init container to copy plugin configs (bypasses itzg sync which fails with DirectoryNotEmptyException)
    initContainers: [getMinecraftPluginConfigInitContainer("shuxin", true)],
  };

  // DNS records are now managed by mc-router

  return new Application(chart, "minecraft-shuxin-app", {
    metadata: {
      name: "minecraft-shuxin",
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
        namespace: "minecraft-shuxin",
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
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true", "RespectIgnoreDifferences=true"],
      },
    },
  });
}
