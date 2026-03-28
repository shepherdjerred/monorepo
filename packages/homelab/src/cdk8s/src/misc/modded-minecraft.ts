import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

// 1Password item path for CurseForge API key (shared across all modded servers)
// The item must have a field named "CF_API_KEY" containing the CurseForge API key
// Obtain from https://console.curseforge.com/
const CURSEFORGE_1P_ITEM_PATH = "vaults/v64ocnykdqju4ui6j6pua56xw4/items/evbgkoazs6dquzlrl5fv7h2gtm";

export interface ModdedMinecraftServerConfig {
  name: string;
  curseForgePageUrl: string;
  hostname: string;
  motd: string;
  memory: string;
  resourceRequests: { memory: string; cpu: string };
  resourceLimits: { memory: string };
  storageGi: number;
  whitelist: string[];
}

export function createModdedMinecraftApp(chart: Chart, config: ModdedMinecraftServerConfig) {
  const namespace = `minecraft-${config.name}`;
  const secretName = `${namespace}-curseforge-api-key`;

  // Create namespace explicitly so the OnePasswordItem can be applied before ArgoCD syncs
  new Namespace(chart, `${namespace}-namespace`, {
    metadata: {
      name: namespace,
    },
  });

  // CurseForge API key secret (1Password operator creates a K8s Secret per namespace)
  new OnePasswordItem(chart, `${namespace}-curseforge-1p`, {
    spec: {
      itemPath: CURSEFORGE_1P_ITEM_PATH,
    },
    metadata: {
      name: secretName,
      namespace,
    },
  });

  const minecraftValues: HelmValuesForChart<"minecraft"> = {
    workloadAsStatefulSet: true,
    strategyType: "RollingUpdate",
    serviceAnnotations: {
      "mc-router.itzg.me/externalServerName": config.hostname,
    },
    image: {
      tag: versions["itzg/minecraft-server"],
    },
    resources: {
      requests: config.resourceRequests,
      limits: config.resourceLimits,
    },
    minecraftServer: {
      eula: true,
      type: "AUTO_CURSEFORGE",
      memory: config.memory,
      motd: config.motd,
      whitelist: config.whitelist.join(","),
      serviceType: "ClusterIP",
      autoCurseForge: {
        apiKey: {
          existingSecret: secretName,
          secretKey: "CF_API_KEY",
        },
        pageUrl: config.curseForgePageUrl,
      },
      rcon: {
        enabled: true,
        withGeneratedPassword: true,
      },
    },
    persistence: {
      storageClass: NVME_STORAGE_CLASS,
      dataDir: {
        Size: Size.gibibytes(config.storageGi).asString(),
        enabled: true,
      },
    },
  };

  return new Application(chart, `${namespace}-app`, {
    metadata: {
      name: namespace,
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
        namespace,
      },
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
