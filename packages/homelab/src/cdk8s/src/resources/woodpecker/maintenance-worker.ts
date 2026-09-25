import { createHash } from "node:crypto";
import { ApiObject, JsonPatch, Size, type Chart } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  FsGroupChangePolicy,
  PersistentVolumeClaim,
  Pods,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { ConfigMap } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  CI_NODE_HOSTNAME,
  ciNodeTaintedNode,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { temporalFeatureFlagEnvironment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/feature-flags.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import { CI_MAINTENANCE_LOCAL_QUEUE } from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import {
  WOODPECKER_BUN_CACHE_CLAIM,
  WOODPECKER_BUN_CACHE_CONTROL_CLAIM,
  WOODPECKER_BUN_CACHE_CONTROL_PATH,
  WOODPECKER_BUN_CACHE_GC_CONFIG_MAP,
  WOODPECKER_BUN_CACHE_PATH,
  WOODPECKER_TRIVY_DB_CLAIM,
  WOODPECKER_TRIVY_DB_PATH,
  WOODPECKER_UV_CACHE_CLAIM,
  WOODPECKER_UV_CACHE_PATH,
} from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/caches.ts";

/**
 * Temporal worker that maintains the CI caches in place.
 *
 * It lives in the CI namespace rather than with the other Temporal workers
 * because the work is filesystem work: it mounts the same ReadWriteMany claims
 * the step pods do and prunes them from the inside. Nothing else can — the
 * claims are node-local NVMe on the CI node, and a claim is only mountable
 * from its own namespace.
 *
 * That namespace is Kueue-managed, so this pod is admitted like any CI pod,
 * but against its own small queue: a long-running worker holding CI quota
 * would shrink every build's budget for good.
 *
 * Its activities are Temporal Schedules (`ci-bun-cache-gc`,
 * `ci-uv-cache-prune-weekly`, `ci-trivy-db-refresh`), not Kubernetes CronJobs,
 * and the alerts in monitoring/rules/woodpecker.ts watch whether those
 * schedules are still succeeding.
 *
 * Kometa rides along here for the same reason it always did: it is the one
 * other recurring subprocess that needs a long-lived writable workspace, and
 * giving it a second worker would double the idle footprint on the CI node.
 */
const NAMESPACE = WOODPECKER_CI_NAMESPACE;
const WORKER_NAME = "temporal-maintenance-worker";
const WORKER_LABELS = {
  app: WORKER_NAME,
  component: "maintenance-worker",
};
/** Where the collector script is projected; the activity invokes it by path. */
export const MAINTENANCE_SCRIPT_PATH = "/woodpecker/maintenance";

const WORKER_IMAGE =
  "ghcr.io/shepherdjerred/temporal-worker:" +
  versions["shepherdjerred/temporal-worker"];

const KOMETA_CONFIG = `libraries:
  Movies:
    collection_files:
      - default: basic
      - default: imdb
      - default: tmdb
    overlay_files:
      - default: resolution
      - default: audio_codec
      - default: ratings
  TV Shows:
    collection_files:
      - default: basic
      - default: imdb
      - default: tmdb
    overlay_files:
      - default: resolution
      - default: audio_codec
      - default: ratings

settings:
  cache: true
  cache_expiration: 60
  asset_directory: /tmp/kometa-assets
  sync_mode: sync
  show_missing_season_assets: false
  show_missing_episode_assets: false
  show_options: false

plex:
  url: http://media-plex-service.media.svc.cluster.local:32400
  token: <<plextoken>>

tmdb:
  apikey: <<tmdbapikey>>
  language: en
`;

function createKometaConfig(chart: Chart): ConfigMap {
  return new ConfigMap(chart, "temporal-maintenance-kometa-config", {
    metadata: {
      name: "temporal-maintenance-kometa-config",
      namespace: NAMESPACE,
    },
    data: { "config.yml": KOMETA_CONFIG },
  });
}

function createKometaSecrets(chart: Chart): {
  plex: ReturnType<typeof Secret.fromSecretName>;
  credentials: ReturnType<typeof Secret.fromSecretName>;
} {
  const plexItem = new OnePasswordItem(
    chart,
    "temporal-maintenance-kometa-plex-1p",
    {
      metadata: {
        name: "temporal-maintenance-kometa-plex-secrets",
        namespace: NAMESPACE,
      },
      spec: { itemPath: vaultItemPath("xov5k65uwjmm3nfhc7udwmvhny") },
    },
  );
  const credentialsItem = new OnePasswordItem(
    chart,
    "temporal-maintenance-kometa-credentials-1p",
    {
      metadata: {
        name: "temporal-maintenance-kometa-credentials",
        namespace: NAMESPACE,
      },
      spec: { itemPath: vaultItemPath("gjrl6xqfupvhwnhgmjsncokiou") },
    },
  );
  return {
    plex: Secret.fromSecretName(
      chart,
      "temporal-maintenance-kometa-plex-secret",
      plexItem.name,
    ),
    credentials: Secret.fromSecretName(
      chart,
      "temporal-maintenance-kometa-credentials-secret",
      credentialsItem.name,
    ),
  };
}

export function createWoodpeckerMaintenanceWorker(chart: Chart): void {
  const config = createKometaConfig(chart);
  const secrets = createKometaSecrets(chart);
  const turboCacheSecret = Secret.fromSecretName(
    chart,
    "temporal-maintenance-turbo-cache-secret",
    "ci-turbo-cache-credentials",
  );
  const deployment = new Deployment(chart, WORKER_NAME, {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    metadata: {
      name: WORKER_NAME,
      namespace: NAMESPACE,
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "CI cache writers run as root; maintenance must share their UID to prune cache entries",
      },
    },
    podMetadata: {
      labels: {
        ...WORKER_LABELS,
        "kueue.x-k8s.io/queue-name": CI_MAINTENANCE_LOCAL_QUEUE,
      },
      annotations: {
        "sjer.red/kometa-config-sha256": createHash("sha256")
          .update(KOMETA_CONFIG)
          .digest("hex"),
      },
    },
    securityContext: {
      fsGroup: 1000,
      fsGroupChangePolicy: FsGroupChangePolicy.ON_ROOT_MISMATCH,
    },
  });
  deployment.scheduling.tolerate(ciNodeTaintedNode());
  // A nodeSelector rather than cdk8s-plus's node affinity: the CI namespace's
  // pod guard (`ci-pod-guard.ts`) requires one on every pod created there.
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/nodeSelector", {
      "kubernetes.io/hostname": CI_NODE_HOSTNAME,
    }),
  );

  const bunCache = Volume.fromPersistentVolumeClaim(
    chart,
    "temporal-maintenance-bun-cache-volume",
    PersistentVolumeClaim.fromClaimName(
      chart,
      "temporal-maintenance-bun-cache",
      WOODPECKER_BUN_CACHE_CLAIM,
    ),
  );
  const bunCacheControl = Volume.fromPersistentVolumeClaim(
    chart,
    "temporal-maintenance-bun-cache-control-volume",
    PersistentVolumeClaim.fromClaimName(
      chart,
      "temporal-maintenance-bun-cache-control",
      WOODPECKER_BUN_CACHE_CONTROL_CLAIM,
    ),
  );
  const uvCache = Volume.fromPersistentVolumeClaim(
    chart,
    "temporal-maintenance-uv-cache-volume",
    PersistentVolumeClaim.fromClaimName(
      chart,
      "temporal-maintenance-uv-cache",
      WOODPECKER_UV_CACHE_CLAIM,
    ),
  );
  const trivyDb = Volume.fromPersistentVolumeClaim(
    chart,
    "temporal-maintenance-trivy-db-volume",
    PersistentVolumeClaim.fromClaimName(
      chart,
      "temporal-maintenance-trivy-db",
      WOODPECKER_TRIVY_DB_CLAIM,
    ),
  );
  const gcScript = Volume.fromConfigMap(
    chart,
    "temporal-maintenance-gc-script-volume",
    ConfigMap.fromConfigMapName(
      chart,
      "temporal-maintenance-gc-script",
      WOODPECKER_BUN_CACHE_GC_CONFIG_MAP,
    ),
    { defaultMode: 0o555 },
  );
  const kometaConfig = Volume.fromConfigMap(
    chart,
    "temporal-maintenance-kometa-config-volume",
    config,
    { items: { "config.yml": { path: "config.yml" } } },
  );
  const kometaState = Volume.fromEmptyDir(
    chart,
    "temporal-maintenance-kometa-state",
    "kometa-state",
  );
  const plexSecretVolume = Volume.fromSecret(
    chart,
    "temporal-maintenance-kometa-plex-volume",
    secrets.plex,
    { items: { password: { path: "plex-token" } } },
  );
  const tmdbSecretVolume = Volume.fromSecret(
    chart,
    "temporal-maintenance-kometa-tmdb-volume",
    secrets.credentials,
    { items: { TMDB_API_KEY: { path: "tmdb-api-key" } } },
  );
  const turboCacheTokenVolume = Volume.fromSecret(
    chart,
    "temporal-maintenance-turbo-cache-token-volume",
    turboCacheSecret,
    { items: { TURBO_TOKEN: { path: "token" } } },
  );

  deployment.addInitContainer(
    withCommonProps({
      name: "copy-kometa-config",
      image: WORKER_IMAGE,
      command: ["/bin/sh", "-c"],
      args: ["cp /etc/kometa-config/config.yml /etc/kometa/config.yml"],
      securityContext: {
        user: 0,
        group: 0,
        ensureNonRoot: false,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: { request: Cpu.millis(10), limit: Cpu.millis(100) },
        memory: {
          request: Size.mebibytes(16),
          limit: Size.mebibytes(64),
        },
        // cdk8s-plus renders ephemeral storage in whole gibibytes.
        ephemeralStorage: {
          request: Size.gibibytes(1),
          limit: Size.gibibytes(1),
        },
      },
      volumeMounts: [
        { path: "/etc/kometa-config", volume: kometaConfig, readOnly: true },
        { path: "/etc/kometa", volume: kometaState },
      ],
    }),
  );

  deployment.addContainer(
    withCommonProps({
      name: WORKER_NAME,
      image: WORKER_IMAGE,
      ports: [
        { name: "metrics", number: 9464 },
        { name: "app-metrics", number: 9465 },
      ],
      securityContext: {
        // The CI image has no USER directive and writes the shared cache as
        // root. Run maintenance with the same UID so root-owned cache entries
        // remain writable and prunable after GC.
        user: 0,
        group: 0,
        ensureNonRoot: false,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: { request: Cpu.millis(500), limit: Cpu.millis(2000) },
        memory: { request: Size.gibibytes(1), limit: Size.gibibytes(2) },
        // Kometa's cache and logs live on emptyDir, which counts here.
        ephemeralStorage: {
          request: Size.gibibytes(1),
          limit: Size.gibibytes(8),
        },
      },
      startup: Probe.fromHttpGet("/healthz", { port: 9465 }),
      liveness: Probe.fromHttpGet("/healthz", { port: 9465 }),
      readiness: Probe.fromHttpGet("/healthz", { port: 9465 }),
      envVariables: {
        // This role's worker.ts main() calls initializeCallGraphTracing()
        // unconditionally on every boot, which loads feature-flag config
        // before anything else; without FEATURE_FLAGS_MODE that throws
        // immediately, crash-looping this worker.
        ...temporalFeatureFlagEnvironment(),
        TEMPORAL_ADDRESS: EnvValue.fromValue(
          "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
        ),
        TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
        TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
        TEMPORAL_WORKER_ROLE: EnvValue.fromValue("maintenance"),
        ENVIRONMENT: EnvValue.fromValue("production"),
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue(WORKER_NAME),
        HOME: EnvValue.fromValue("/tmp"),
        KOMETA_PLEXTOKEN_FILE: EnvValue.fromValue(
          "/run/secrets/kometa-plex/plex-token",
        ),
        KOMETA_TMDBAPIKEY_FILE: EnvValue.fromValue(
          "/run/secrets/kometa-tmdb/tmdb-api-key",
        ),
        TURBO_CACHE_TOKEN_FILE: EnvValue.fromValue(
          "/run/secrets/turbo-cache/token",
        ),
      },
      volumeMounts: [
        { path: WOODPECKER_BUN_CACHE_PATH, volume: bunCache },
        { path: WOODPECKER_BUN_CACHE_CONTROL_PATH, volume: bunCacheControl },
        { path: WOODPECKER_UV_CACHE_PATH, volume: uvCache },
        { path: WOODPECKER_TRIVY_DB_PATH, volume: trivyDb },
        { path: MAINTENANCE_SCRIPT_PATH, volume: gcScript, readOnly: true },
        // Kometa writes logs and cache beside config.yml. Keep its state
        // writable and project only the declarative configuration read-only.
        { path: "/etc/kometa", volume: kometaState },
        {
          path: "/run/secrets/kometa-plex",
          volume: plexSecretVolume,
          readOnly: true,
        },
        {
          path: "/run/secrets/kometa-tmdb",
          volume: tmdbSecretVolume,
          readOnly: true,
        },
        {
          path: "/run/secrets/turbo-cache",
          volume: turboCacheTokenVolume,
          readOnly: true,
        },
        {
          path: "/tmp",
          volume: Volume.fromEmptyDir(chart, "temporal-maintenance-tmp", "tmp"),
        },
      ],
    }),
  );
  setRevisionHistoryLimit(deployment, 5);

  const maintenanceSelector = Pods.select(
    chart,
    "temporal-maintenance-worker-selector",
    { labels: { component: "maintenance-worker" } },
  );
  new Service(chart, "temporal-maintenance-worker-metrics-service", {
    metadata: {
      name: "temporal-maintenance-worker-metrics",
      namespace: NAMESPACE,
      labels: { component: "maintenance-worker-metrics" },
    },
    selector: maintenanceSelector,
    ports: [{ name: "metrics", port: 9464 }],
  });
  createServiceMonitor(chart, {
    name: "temporal-maintenance-worker-metrics",
    namespace: NAMESPACE,
    matchLabels: { component: "maintenance-worker-metrics" },
  });
  new Service(chart, "temporal-maintenance-worker-app-metrics-service", {
    metadata: {
      name: "temporal-maintenance-worker-app-metrics",
      namespace: NAMESPACE,
      labels: { component: "maintenance-worker-app-metrics" },
    },
    selector: maintenanceSelector,
    ports: [{ name: "app-metrics", port: 9465, targetPort: 9465 }],
  });
  createServiceMonitor(chart, {
    name: "temporal-maintenance-worker-app-metrics",
    namespace: NAMESPACE,
    port: "app-metrics",
    matchLabels: { component: "maintenance-worker-app-metrics" },
  });
}
