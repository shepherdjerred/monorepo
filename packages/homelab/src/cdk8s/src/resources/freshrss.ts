import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  Capability,
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  SeccompProfileType,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import {
  FRESHRSS_DESIRED_JSON,
  FRESHRSS_REPO_STACK_OPML,
  FRESHRSS_SOURCE_OPML,
} from "./freshrss-config.ts";

const FRESHRSS_USER = "sjerred";
const FRESHRSS_API_CONFIG = `<?php
return [
    'api_enabled' => true,
];
`;
const FRESHRSS_LOCAL_SETTINGS_SCRIPT = `set -u

password_file=/run/secrets/freshrss/password
last_password_digest=

while :; do
  password_digest=$(sha256sum "$password_file" | awk '{ print $1 }')
  if [ "$password_digest" != "$last_password_digest" ]; then
    api_password=$(cat "$password_file")
    if php /var/www/FreshRSS/cli/update-user.php --user "$FRESHRSS_USER" --api-password "$api_password"; then
      last_password_digest=$password_digest
    fi
  fi

  php /config/reconcile-filters.php
  sleep 30
done
`;
const CONFIG_MAP_NAME = "freshrss-declarative-config";
const SERVICE_NAME = "freshrss-service";

async function createDeclarativeConfig(chart: Chart): Promise<ConfigMap> {
  const filterReconcilerSource = await Bun.file(
    new URL("freshrss-filter-reconciler.php", import.meta.url),
  ).text();

  return new ConfigMap(chart, "freshrss-declarative-config", {
    metadata: { name: CONFIG_MAP_NAME },
    data: {
      "config.custom.php": FRESHRSS_API_CONFIG,
      "feeds.opml": FRESHRSS_SOURCE_OPML,
      "repo-stack.opml": FRESHRSS_REPO_STACK_OPML,
      "desired.json": FRESHRSS_DESIRED_JSON,
      "reconcile-filters.php": filterReconcilerSource,
    },
  });
}

export async function createFreshRssDeployment(chart: Chart): Promise<void> {
  const declarativeConfig = await createDeclarativeConfig(chart);
  const syncCredential = new OnePasswordItem(
    chart,
    "freshrss-sync-secret-item",
    {
      metadata: { name: "freshrss-sync" },
      spec: { itemPath: vaultItemPath("freshrss-sync") },
    },
  );
  const syncSecret = Secret.fromSecretName(
    chart,
    "freshrss-sync-secret",
    syncCredential.name,
  );
  const deployment = new Deployment(chart, "freshrss", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    podMetadata: { labels: { app: "freshrss" } },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "FreshRSS requires root for PHP-FPM and cron operations",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "FreshRSS requires writable filesystem for sessions and cache",
      },
    },
  });

  const freshRssDataVolume = new ZfsNvmeVolume(chart, "freshrss-data", {
    storage: Size.gibibytes(32),
  });
  const freshRssExtensionsVolme = new ZfsNvmeVolume(
    chart,
    "freshrss-extensions",
    {
      storage: Size.gibibytes(8),
    },
  );
  const dataVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "freshrss-data-volume",
    freshRssDataVolume.claim,
  );
  const extensionsVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "freshrss-extensions-volume",
    freshRssExtensionsVolme.claim,
  );
  const configVolume = Volume.fromConfigMap(
    chart,
    "freshrss-declarative-config-volume",
    declarativeConfig,
  );
  const syncCredentialVolume = Volume.fromSecret(
    chart,
    "freshrss-sync-secret-volume",
    syncSecret,
    { items: { password: { path: "password" } } },
  );

  deployment.addContainer(
    withCommonProps({
      // Deliberately BestEffort (no requests/limits) — negligible or
      // non-critical usage; see the 2026-06-12 right-sizing plan.
      resources: {},
      image: `freshrss/freshrss:${versions["freshrss/freshrss"]}`,
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      envVariables: {
        // Enable cron for automatic feed updates every hour
        CRON_MIN: EnvValue.fromValue("13"), // Run at minute 13 of every hour
      },
      volumeMounts: [
        {
          path: "/var/www/FreshRSS/data",
          volume: dataVolume,
        },
        {
          path: "/var/www/FreshRSS/extensions",
          volume: extensionsVolume,
        },
        {
          path: "/var/www/FreshRSS/data/config.custom.php",
          subPath: "config.custom.php",
          readOnly: true,
          volume: configVolume,
        },
      ],
    }),
  );

  deployment.addContainer(
    withCommonProps({
      name: "reconcile-local-settings",
      image: `freshrss/freshrss:${versions["freshrss/freshrss"]}`,
      command: ["/bin/sh", "-c"],
      args: [FRESHRSS_LOCAL_SETTINGS_SCRIPT],
      envVariables: {
        FRESHRSS_USER: EnvValue.fromValue(FRESHRSS_USER),
        FRESHRSS_MANIFEST_PATH: EnvValue.fromValue("/config/desired.json"),
      },
      resources: {
        cpu: { request: Cpu.millis(5), limit: Cpu.millis(100) },
        memory: {
          request: Size.mebibytes(16),
          limit: Size.mebibytes(64),
        },
      },
      securityContext: {
        ensureNonRoot: true,
        user: 33,
        group: 33,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        privileged: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      volumeMounts: [
        { path: "/var/www/FreshRSS/data", volume: dataVolume },
        {
          path: "/run/secrets/freshrss",
          readOnly: true,
          volume: syncCredentialVolume,
        },
        {
          path: "/config",
          readOnly: true,
          volume: configVolume,
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "freshrss-service", {
    metadata: { name: SERVICE_NAME },
    selector: deployment,
    ports: [{ port: 80 }],
  });

  new TailscaleIngress(chart, "freshrss-tailscale-ingress", {
    service,
    host: "freshrss",
  });

  createCloudflareTunnelBinding(chart, "freshrss-cf-tunnel", {
    serviceName: service.name,
    subdomain: "freshrss",
    port: 80,
  });
}
