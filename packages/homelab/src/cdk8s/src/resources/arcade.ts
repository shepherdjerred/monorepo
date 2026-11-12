import { ApiObject, Duration, JsonPatch, Size } from "cdk8s";
import type { Chart } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  EmptyDirMedium,
  EnvValue,
  Job,
  Probe,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { BURST_SERVICE_PRIORITY } from "@shepherdjerred/homelab/cdk8s/src/misc/priority-classes.ts";
import { FirstPartyWorker } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/worker.ts";
import type { FirstPartyContainerSpec } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/workload-parts.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { peerUserbotIds } from "@shepherdjerred/homelab/cdk8s/src/resources/userbot-ids.ts";
import {
  telemetryEnv,
  seaweedfsS3,
  FLIPT_URL,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export const APP_ROOT = "/app/packages/arcade";
const ARCADE_NODE_SELECTOR = { "kubernetes.io/hostname": "torvalds" };

export function createArcadeDeployment(
  chart: Chart,
  { controllerActive = true }: { controllerActive?: boolean } = {},
) {
  // Arcade owns the command bot and both streaming accounts after migration.
  const worker = new FirstPartyWorker(chart, "arcade-worker", {
    name: "arcade",
    deployment: {
      replicas: controllerActive ? 1 : 0,
      // Emerald's goal worker and save retries use the same budget as its legacy pod.
      terminationGracePeriod: Duration.seconds(120),
      securityContext: { fsGroup: 1000 },
      metadata: {
        annotations: {
          "ignore-check.kube-linter.io/no-read-only-root-fs":
            "Chromium profiles and runtime scratch require writable storage",
        },
      },
    },
    priorityClassName: BURST_SERVICE_PRIORITY,
    containers: () => ({ main: arcadeContainer(chart, controllerActive) }),
    // The UI port serves `/metrics` too, and arcade-edge proxies to this Service.
    metrics: {
      serviceId: "arcade-ui",
      app: "arcade",
      port: 8081,
      portName: "ui",
      monitorName: "arcade",
    },
    // arcade-edge is the namespace's only ingress; it has no policies yet.
    policies: [],
  });
  ApiObject.of(worker.deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/nodeSelector", ARCADE_NODE_SELECTOR),
    JsonPatch.add(
      "/spec/template/spec/containers/0/resources/limits/gpu.intel.com~1i915",
      1,
    ),
  );
}

/**
 * The controller container, with the claims, configuration and credentials it
 * mounts.
 */
function arcadeContainer(
  chart: Chart,
  controllerActive: boolean,
): FirstPartyContainerSpec {
  const assets = new ZfsNvmeVolume(chart, "arcade-assets", {
    storage: Size.gibibytes(64),
  });
  const saves = new ZfsNvmeVolume(chart, "arcade-saves", {
    storage: Size.gibibytes(32),
  });
  const database = new ZfsNvmeVolume(chart, "arcade-database", {
    storage: Size.gibibytes(8),
  });
  const goalAuth = new ZfsNvmeVolume(chart, "arcade-goal-auth", {
    storage: Size.gibibytes(1),
  });
  // The running controller binds its own claims. A second read-only consumer
  // cannot mount these ZFS datasets alongside its writable save/database mounts.
  if (!controllerActive) {
    // Bind storage before deployment startup or asset/save migration.
    // The Sync hook shares the claims' wave so WaitForFirstConsumer can schedule it.
    const storagePreparation = new Job(chart, "arcade-storage-prepare", {
      metadata: {
        name: "arcade-storage-prepare",
        annotations: {
          "argocd.argoproj.io/hook": "Sync",
          "argocd.argoproj.io/hook-delete-policy":
            "BeforeHookCreation,HookSucceeded",
        },
      },
      automountServiceAccountToken: false,
      backoffLimit: 1,
      activeDeadline: Duration.minutes(5),
    });
    storagePreparation.addContainer(
      withCommonProps({
        image: `busybox:${versions["library/busybox"]}`,
        command: ["/bin/sh", "-ec"],
        args: [
          "test -d /storage/assets && test -d /storage/saves && test -d /storage/database && test -d /storage/goal-auth",
        ],
        securityContext: {
          user: 1000,
          group: 1000,
          ensureNonRoot: true,
          readOnlyRootFilesystem: true,
          allowPrivilegeEscalation: false,
        },
        resources: {
          cpu: { request: Cpu.millis(10), limit: Cpu.millis(100) },
          memory: { request: Size.mebibytes(16), limit: Size.mebibytes(64) },
        },
        volumeMounts: [
          { path: "/storage/assets", claim: assets.claim },
          { path: "/storage/saves", claim: saves.claim },
          { path: "/storage/database", claim: database.claim },
          { path: "/storage/goal-auth", claim: goalAuth.claim },
        ].map(({ path, claim }) => ({
          path,
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            `${claim.name}-prepare-mount`,
            claim,
            { readOnly: true },
          ),
          readOnly: true,
        })),
      }),
    );
    ApiObject.of(storagePreparation).addJsonPatch(
      JsonPatch.add("/spec/template/spec/nodeSelector", ARCADE_NODE_SELECTOR),
    );
  }
  const config = new ConfigMap(chart, "arcade-config", {
    data: {
      "arcade.toml": `controllerActive = ${controllerActive.toString()}
enabled = false
mkwiiEnabled = false
meleeEnabled = false
brawlEnabled = false
maxSessions = 2
maxHeavySessions = 1
goalGuildIds = ["208425771172102144", "1337623164146155593"]
stateRoot = "/data/saves"
databasePath = "/data/db/arcade.db"
webAssets = "${APP_ROOT}/packages/frontend/dist"

[streamVideo]
frame_rate = 30
bitrate_kbps = 5000
bitrate_max_kbps = 8000
hardware_acceleration = true
vaapi_device = "/dev/dri/renderD128"

[emeraldStreamVideo]
frame_rate = 30
bitrate_kbps = 1500
bitrate_max_kbps = 4000
hardware_acceleration = true
vaapi_device = "/dev/dri/renderD128"

[driverFeed]
enabled = true
max_clients = 4

[emeraldGoal]
enabled = true
model = "gpt-5.6-sol"
`,
    },
  });
  const credentials = new OnePasswordItem(chart, "arcade-credentials", {
    spec: {
      itemPath: vaultItemPath("w4756fcswk2o5znfn4lzfqxgtm"),
    },
  });
  const credentialSecret = Secret.fromSecretName(
    chart,
    "arcade-credential-secret",
    credentials.name,
  );
  const archiveItem = seaweedfsS3.item(chart, "arcade-archive");
  const archiveSecret = Secret.fromSecretName(
    chart,
    "arcade-archive-secret",
    archiveItem.name,
  );
  return {
    image:
      '{{ required `Delivery requires image` (get (.Values.delivery | default dict) "image") }}',
    envVariables: {
      ARCADE_CONFIG_PATH: EnvValue.fromValue("/config/arcade.toml"),
      NODE_ENV: EnvValue.fromValue("production"),
      FEATURE_FLAGS_MODE: EnvValue.fromValue("flipt"),
      FLIPT_NAMESPACE: EnvValue.fromValue("arcade"),
      FLIPT_ENVIRONMENT: EnvValue.fromValue("prod"),
      DEPLOYMENT_ENVIRONMENT: EnvValue.fromValue("prod"),
      FLIPT_URL: EnvValue.fromValue(FLIPT_URL),
      PEER_USERBOT_IDS: EnvValue.fromValue(peerUserbotIds("arcade1")),
      // Shared origin for Discord links, OAuth, and browser controller traffic.
      WEB_PUBLIC_ORIGIN: EnvValue.fromValue("https://arcade.sjer.red"),
      DISCORD_BOT_TOKEN: EnvValue.fromSecretValue({
        secret: credentialSecret,
        key: "DISCORD_BOT_TOKEN",
      }),
      DISCORD_APPLICATION_ID: EnvValue.fromSecretValue({
        secret: credentialSecret,
        key: "DISCORD_APPLICATION_ID",
      }),
      DISCORD_STREAMING_TOKENS: EnvValue.fromSecretValue({
        secret: credentialSecret,
        key: "DISCORD_STREAMING_TOKENS",
      }),
      DISCORD_CLIENT_SECRET: EnvValue.fromSecretValue({
        secret: credentialSecret,
        key: "DISCORD_CLIENT_SECRET",
      }),
      CODEX_AUTH_JSON_B64: EnvValue.fromSecretValue({
        secret: credentialSecret,
        key: "CODEX_AUTH_JSON_B64",
      }),
      CODEX_HOME: EnvValue.fromValue("/data/goal-auth/codex"),
      LIBVA_DRIVER_NAME: EnvValue.fromValue("iHD"),
      ...telemetryEnv({ serviceName: "arcade", serviceNameFirst: true }),
      ...seaweedfsS3.credentialsEnv(archiveSecret),
      AWS_ENDPOINT_URL: EnvValue.fromValue(seaweedfsS3.endpoint),
      S3_ENDPOINT: EnvValue.fromValue(seaweedfsS3.endpoint),
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
      // Working set peaked at 2.8 GiB (p95 1.2 GiB) over its first four
      // days, then settled: 7d p95 230 MiB, 14d max 1.7 GiB (2026-10-31).
      // Request the steady state; the limit keeps room for bursts.
      memory: { request: Size.mebibytes(256), limit: Size.gibibytes(16) },
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
        path: "/data/goal-auth",
        volume: Volume.fromPersistentVolumeClaim(
          chart,
          "arcade-goal-auth-mount",
          goalAuth.claim,
        ),
      },
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
    ],
  };
}
