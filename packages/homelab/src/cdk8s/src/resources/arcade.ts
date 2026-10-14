import { ApiObject, JsonPatch, Size } from "cdk8s";
import type { Chart } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  DeploymentStrategy,
  EmptyDirMedium,
  EnvValue,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  createBurstDeployment,
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { peerUserbotIds } from "@shepherdjerred/homelab/cdk8s/src/resources/userbot-ids.ts";

export const APP_ROOT = "/app/packages/arcade";

export function createArcadeDeployment(chart: Chart) {
  // Preserve legacy owners until assets, copied saves, and beta acceptance pass.
  const deployment = createBurstDeployment(chart, "arcade", {
    replicas: 0,
    strategy: DeploymentStrategy.recreate(),
    securityContext: { fsGroup: 1000 },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Chromium profiles and runtime scratch require writable storage",
      },
    },
  });
  const assets = new ZfsNvmeVolume(chart, "arcade-assets", {
    storage: Size.gibibytes(64),
  });
  const saves = new ZfsNvmeVolume(chart, "arcade-saves", {
    storage: Size.gibibytes(32),
  });
  const database = new ZfsNvmeVolume(chart, "arcade-database", {
    storage: Size.gibibytes(8),
  });
  const config = new ConfigMap(chart, "arcade-config", {
    data: {
      "arcade.toml": `controllerActive = false\nenabled = false\nmkwiiEnabled = false\nmeleeEnabled = false\nbrawlEnabled = false\nstateRoot = "/data/saves"\ndatabasePath = "/data/db/arcade.db"\nwebAssets = "${APP_ROOT}/packages/frontend/dist"\n`,
    },
  });
  const mk64 = new OnePasswordItem(chart, "arcade-mk64", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/fcugoc3kohpmfwzfvko4hgysyq",
    },
  });
  const emerald = new OnePasswordItem(chart, "arcade-emerald", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/hwyhh64dyu3s7w37q7oj7r4qn4",
    },
  });
  const mkSecret = Secret.fromSecretName(
    chart,
    "arcade-mk64-secret",
    mk64.name,
  );
  const archiveItem = new OnePasswordItem(chart, "arcade-archive", {
    spec: { itemPath: vaultItemPath("vet52jaeh75chsalu6lulugium") },
  });
  const archiveSecret = Secret.fromSecretName(
    chart,
    "arcade-archive-secret",
    archiveItem.name,
  );
  const emeraldSecret = Secret.fromSecretName(
    chart,
    "arcade-emerald-secret",
    emerald.name,
  );
  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/arcade:${versions["shepherdjerred/arcade"]}`,
      envVariables: {
        ARCADE_CONFIG_PATH: EnvValue.fromValue("/config/arcade.toml"),
        NODE_ENV: EnvValue.fromValue("production"),
        FEATURE_FLAGS_MODE: EnvValue.fromValue("flipt"),
        FLIPT_NAMESPACE: EnvValue.fromValue("arcade"),
        FLIPT_ENVIRONMENT: EnvValue.fromValue("prod"),
        FLIPT_URL: EnvValue.fromValue(
          "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
        ),
        PEER_USERBOT_IDS: EnvValue.fromValue(peerUserbotIds("marioKart")),
        // Cutover also changes OAuth origin and routing; standby cannot log in.
        WEB_PUBLIC_ORIGIN: EnvValue.fromValue("https://mariokart.sjer.red"),
        DISCORD_CLIENT_SECRET: EnvValue.fromSecretValue({
          secret: mkSecret,
          key: "DISCORD_CLIENT_SECRET",
        }),
        CODEX_ACCESS_TOKEN: EnvValue.fromSecretValue({
          secret: emeraldSecret,
          key: "CODEX_ACCESS_TOKEN",
        }),
        STREAM_HARDWARE_ACCELERATION: EnvValue.fromValue("true"),
        VAAPI_DEVICE: EnvValue.fromValue("/dev/dri/renderD128"),
        LIBVA_DRIVER_NAME: EnvValue.fromValue("iHD"),
        DRIVER_FEED_ENABLED: EnvValue.fromValue("true"),
        DRIVER_FEED_MAX_CLIENTS: EnvValue.fromValue("4"),
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue("arcade"),
        OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
        AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
          secret: archiveSecret,
          key: "SEAWEEDFS_ACCESS_KEY_ID",
        }),
        AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
          secret: archiveSecret,
          key: "SEAWEEDFS_SECRET_ACCESS_KEY",
        }),
        AWS_ENDPOINT_URL: EnvValue.fromValue(
          "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
        ),
        S3_ENDPOINT: EnvValue.fromValue(
          "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
        ),
        S3_FORCE_PATH_STYLE: EnvValue.fromValue("true"),
        AWS_REGION: EnvValue.fromValue("us-east-1"),
        ...llmArchiveEnvVars(),
        LLM_ARCHIVE_S3_PREFIX: EnvValue.fromValue("goals/arcade"),
      },
      securityContext: {
        ensureNonRoot: true,
        user: 1000,
        group: 1000,
        readOnlyRootFilesystem: false,
        allowPrivilegeEscalation: false,
      },
      resources: {
        cpu: { request: Cpu.units(2), limit: Cpu.units(12) },
        memory: { request: Size.gibibytes(6), limit: Size.gibibytes(16) },
      },
      ports: [{ name: "ui", number: 8081 }],
      startup: Probe.fromHttpGet("/health", {
        port: 8081,
        failureThreshold: 60,
      }),
      readiness: Probe.fromHttpGet("/health", { port: 8081 }),
      liveness: Probe.fromHttpGet("/health", { port: 8081 }),
      volumeMounts: [
        {
          path: "/data/assets",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "arcade-assets-mount",
            assets.claim,
          ),
          readOnly: true,
        },
        {
          path: "/data/saves",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "arcade-saves-mount",
            saves.claim,
          ),
        },
        {
          path: "/data/db",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "arcade-db-pvc",
            database.claim,
          ),
        },
        {
          path: "/dev/shm",
          volume: Volume.fromEmptyDir(chart, "arcade-shm", "arcade-shm", {
            medium: EmptyDirMedium.MEMORY,
            sizeLimit: Size.gibibytes(1),
          }),
        },
        {
          path: "/config/arcade.toml",
          subPath: "arcade.toml",
          volume: Volume.fromConfigMap(chart, "arcade-config-volume", config),
        },
        {
          path: "/config/mk64.toml",
          subPath: "config.toml",
          volume: Volume.fromSecret(chart, "arcade-mk64-config", mkSecret),
        },
        {
          path: "/config/emerald.toml",
          subPath: "config.toml",
          volume: Volume.fromSecret(
            chart,
            "arcade-emerald-config",
            emeraldSecret,
          ),
        },
      ],
    }),
  );
  setRevisionHistoryLimit(deployment);
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/nodeSelector", {
      "kubernetes.io/hostname": "torvalds",
    }),
    JsonPatch.add(
      "/spec/template/spec/containers/0/resources/limits/gpu.intel.com~1i915",
      1,
    ),
  );
  const service = new Service(chart, "arcade-ui", {
    metadata: { labels: { app: "arcade" } },
    selector: deployment,
    ports: [{ name: "ui", port: 8081 }],
  });
  createServiceMonitor(chart, {
    name: "arcade",
    namespace: "arcade",
    port: "ui",
    path: "/metrics",
    matchLabels: { app: "arcade" },
  });
  // Standby has zero replicas while legacy accounts retain their owners.
  new TailscaleIngress(chart, "arcade-ingress", {
    service,
    host: "arcade",
    disableProbe: true,
  });
}
