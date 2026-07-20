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
import { withCommonLinuxServerProps } from "@shepherdjerred/homelab/cdk8s/src/misc/linux-server.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { setRevisionHistoryLimit } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CURRENT_DIRNAME = path.dirname(fileURLToPath(import.meta.url));

/**
 * Recyclarr config is git-owned (ConfigMap). API keys still live in the
 * 1Password "Recyclarr" item as an embedded recyclarr.yaml (legacy). An init
 * container extracts radarr/sonarr api_key values into secrets.yml so the git
 * config can reference them via !secret without putting keys in git.
 */
export async function createRecyclarrDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "recyclarr", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "LinuxServer.io images run as root internally",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "LinuxServer.io images require writable filesystem",
      },
    },
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

  // Legacy 1Password item: full recyclarr.yaml with embedded API keys.
  // Only the api_key lines are consumed (see init container).
  const configItem = new OnePasswordItem(
    chart,
    "recyclarr-config-onepassword-homelab",
    {
      spec: {
        itemPath: vaultItemPath("fu5ufvg6bx3kkcp7lqi5pmwj2a"),
      },
      metadata: {
        name: "recyclarr-config-homelab",
      },
    },
  );

  const secret = Secret.fromSecretName(
    chart,
    "recyclarr-config-secret",
    configItem.name,
  );

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

  const legacySecretVolume = Volume.fromSecret(
    chart,
    "recyclarr-legacy-secret-volume",
    secret,
    {
      items: {
        "recyclarr.yaml": {
          path: "recyclarr.yaml",
        },
      },
    },
  );

  // Extract api keys from the legacy 1P yaml into secrets.yml and install the
  // git-owned recyclarr.yaml into /config (PVC). Pure shell — no yq needed.
  const initScript = [
    "set -eu",
    "mkdir -p /config",
    "LEGACY=/legacy/recyclarr.yaml",
    'test -f "$LEGACY"',
    "awk '",
    '/^radarr:/{s="radarr"}',
    '/^sonarr:/{s="sonarr"}',
    "/^[[:space:]]*api_key:/{",
    "  key=$2",
    '  if (s=="radarr" && radarr=="") radarr=key',
    '  if (s=="sonarr" && sonarr=="") sonarr=key',
    "}",
    "END {",
    '  if (radarr=="" || sonarr=="") {',
    '    print "failed to extract radarr/sonarr api_key from legacy 1Password recyclarr.yaml" > "/dev/stderr"',
    "    exit 1",
    "  }",
    '  print "radarr_api_key: " radarr',
    '  print "sonarr_api_key: " sonarr',
    "}",
    '\' "$LEGACY" > /config/secrets.yml',
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
      { path: "/legacy", volume: legacySecretVolume },
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
