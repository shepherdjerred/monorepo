import {
  ConfigMap,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  withCommonLinuxServerProps,
  linuxServerPod,
} from "@shepherdjerred/homelab/cdk8s/src/misc/linux-server.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { setRevisionHistoryLimit } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import path from "node:path";

const CURRENT_DIRNAME = import.meta.dir;

/**
 * Recyclarr config is git-owned. Its API keys share the canonical Radarr and
 * Sonarr items used by OpenTofu; the init container renders only secrets.yml.
 */
export async function createRecyclarrDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "recyclarr", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    ...linuxServerPod(),
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "recyclarr-pvc", {
    storage: Size.gibibytes(8),
  });

  const configPath = path.join(
    CURRENT_DIRNAME,
    "../../../config/recyclarr/recyclarr.yaml",
  );
  const configContent = await Bun.file(configPath).text();

  const configMap = new ConfigMap(chart, "recyclarr-config", {
    metadata: {
      name: "recyclarr-config",
    },
    data: {
      "recyclarr.yaml": configContent,
    },
  });

  const credentialVolumes = [
    {
      name: "radarr",
      itemId: "tvy75zdvgyajf57rvzywc7nqbu",
      field: "RADARR_API_KEY",
    },
    {
      name: "sonarr",
      itemId: "ou5byilomqmlx7askklqonyxfi",
      field: "SONARR_API_KEY",
    },
  ].map(({ name, itemId, field }) => {
    const item = new OnePasswordItem(
      chart,
      "recyclarr-" + name + "-credential",
      {
        spec: { itemPath: vaultItemPath(itemId) },
        metadata: { name: "recyclarr-" + name + "-credential" },
      },
    );
    const secret = Secret.fromSecretName(
      chart,
      "recyclarr-" + name + "-secret",
      item.name,
    );
    return {
      name,
      volume: Volume.fromSecret(
        chart,
        "recyclarr-" + name + "-volume",
        secret,
        {
          items: { [field]: { path: "api-key" } },
        },
      ),
    };
  });

  const configVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "recyclarr-volume",
    localPathVolume.claim,
  );

  const gitConfigVolume = Volume.fromConfigMap(
    chart,
    "recyclarr-git-config-volume",
    configMap,
  );

  const initScript = [
    "set -eu",
    "umask 077",
    "mkdir -p /config",
    "RADARR_KEY=$(cat /credentials/radarr/api-key)",
    "SONARR_KEY=$(cat /credentials/sonarr/api-key)",
    'test -n "$RADARR_KEY" && test -n "$SONARR_KEY"',
    String.raw`printf "radarr_api_key: %s\nsonarr_api_key: %s\n" "$RADARR_KEY" "$SONARR_KEY" > /config/secrets.yml`,
    "cp /git/recyclarr.yaml /config/recyclarr.yaml",
    "chmod 600 /config/secrets.yml /config/recyclarr.yaml",
  ].join("\n");

  // Root only so a fresh/root-owned PVC can receive secrets.yml + recyclarr.yaml
  // (same pattern as qbittorrent-config-seed). Files are mode 600 afterward.
  deployment.addInitContainer({
    name: "render-config",
    image: `library/busybox:${versions["library/busybox"]}`,
    command: ["/bin/sh", "-c", initScript],
    resources: {},
    securityContext: {
      ensureNonRoot: false,
      user: 0,
      group: 0,
      privileged: false,
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
    },
    volumeMounts: [
      { path: "/config", volume: configVolume },
      { path: "/git", volume: gitConfigVolume },
      ...credentialVolumes.map(({ name, volume }) => ({
        path: "/credentials/" + name,
        volume,
      })),
    ],
  });

  deployment.addContainer(
    withCommonLinuxServerProps({
      // Deliberately BestEffort (no requests/limits) — negligible or
      // non-critical usage; see the 2026-06-12 right-sizing plan.
      resources: {},
      image: `ghcr.io/recyclarr/recyclarr:${versions.recyclarr}`,
      envVariables: {
        CRON_SCHEDULE: EnvValue.fromValue("@daily"),
      },
      volumeMounts: [
        {
          path: "/config",
          volume: configVolume,
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);
}
