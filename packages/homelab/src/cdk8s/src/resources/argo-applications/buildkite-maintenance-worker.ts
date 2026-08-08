import { createHash } from "node:crypto";
import { Size, type Chart } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  FsGroupChangePolicy,
  Node,
  NodeLabelQuery,
  PersistentVolumeClaim,
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
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";

const NAMESPACE = "buildkite";
const WORKER_NAME = "temporal-maintenance-worker";
const WORKER_LABELS = { app: WORKER_NAME };
// The image pin is updated by the main-branch image pipeline in a follow-up
// commit. Keep this Deployment scaled down while the committed pin still
// points at the pre-maintenance worker; otherwise ArgoCD would remove the old
// schedulers and start a worker that cannot parse TEMPORAL_WORKER_ROLE=maintenance.
const PRE_MAINTENANCE_WORKER_IMAGE =
  "2.0.0-8036@sha256:47a1d29da71b5571ffa9465797b75aa79f12276af8633e69d4be9068decea291";
const WORKER_IMAGE =
  "ghcr.io/shepherdjerred/temporal-worker:" +
  versions["shepherdjerred/temporal-worker"];
const MAINTENANCE_IMAGE_READY =
  versions["shepherdjerred/temporal-worker"] !== PRE_MAINTENANCE_WORKER_IMAGE;

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

export function createBuildkiteMaintenanceWorker(chart: Chart): void {
  const config = createKometaConfig(chart);
  const secrets = createKometaSecrets(chart);
  const deployment = new Deployment(chart, WORKER_NAME, {
    replicas: MAINTENANCE_IMAGE_READY ? 1 : 0,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    metadata: {
      name: WORKER_NAME,
      namespace: NAMESPACE,
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Buildkite CI cache writers run as root; maintenance must share their UID to prune cache entries",
      },
    },
    podMetadata: {
      labels: WORKER_LABELS,
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
  deployment.scheduling.attract(
    Node.labeled(NodeLabelQuery.is("kubernetes.io/hostname", CI_NODE_HOSTNAME)),
  );
  deployment.scheduling.tolerate(ciNodeTaintedNode());

  const bunCache = Volume.fromPersistentVolumeClaim(
    chart,
    "temporal-maintenance-bun-cache-volume",
    PersistentVolumeClaim.fromClaimName(
      chart,
      "temporal-maintenance-bun-cache",
      "buildkite-bun-cache",
    ),
  );
  const bunCacheControl = Volume.fromPersistentVolumeClaim(
    chart,
    "temporal-maintenance-bun-cache-control-volume",
    PersistentVolumeClaim.fromClaimName(
      chart,
      "temporal-maintenance-bun-cache-control",
      "buildkite-bun-cache-control",
    ),
  );
  const uvCache = Volume.fromPersistentVolumeClaim(
    chart,
    "temporal-maintenance-uv-cache-volume",
    PersistentVolumeClaim.fromClaimName(
      chart,
      "temporal-maintenance-uv-cache",
      "buildkite-uv-cache",
    ),
  );
  const trivyDb = Volume.fromPersistentVolumeClaim(
    chart,
    "temporal-maintenance-trivy-db-volume",
    PersistentVolumeClaim.fromClaimName(
      chart,
      "temporal-maintenance-trivy-db",
      "buildkite-trivy-db",
    ),
  );
  const gcScript = Volume.fromConfigMap(
    chart,
    "temporal-maintenance-gc-script-volume",
    ConfigMap.fromConfigMapName(
      chart,
      "temporal-maintenance-gc-script",
      "buildkite-bun-cache-gc",
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
        // Buildkite's CI image has no USER directive and writes the shared
        // cache as root. Run maintenance with the same UID so root-owned
        // cache entries remain writable and prunable after GC.
        user: 0,
        group: 0,
        ensureNonRoot: false,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
      },
      resources: {
        cpu: { request: Cpu.millis(500), limit: Cpu.millis(2000) },
        memory: { request: Size.gibibytes(1), limit: Size.gibibytes(2) },
      },
      startup: Probe.fromHttpGet("/healthz", { port: 9465 }),
      liveness: Probe.fromHttpGet("/healthz", { port: 9465 }),
      readiness: Probe.fromHttpGet("/healthz", { port: 9465 }),
      envVariables: {
        TEMPORAL_ADDRESS: EnvValue.fromValue(
          "temporal-server-service.temporal.svc.cluster.local:7233",
        ),
        TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
        TEMPORAL_WORKER_ROLE: EnvValue.fromValue("maintenance"),
        ENVIRONMENT: EnvValue.fromValue("production"),
        TELEMETRY_ENABLED: EnvValue.fromValue("true"),
        OTLP_ENDPOINT: EnvValue.fromValue(
          "http://tempo.tempo.svc.cluster.local:4318",
        ),
        TELEMETRY_SERVICE_NAME: EnvValue.fromValue(WORKER_NAME),
        HOME: EnvValue.fromValue("/tmp"),
        KOMETA_PLEXTOKEN: EnvValue.fromSecretValue({
          secret: secrets.plex,
          key: "password",
        }),
        KOMETA_TMDBAPIKEY: EnvValue.fromSecretValue({
          secret: secrets.credentials,
          key: "TMDB_API_KEY",
        }),
      },
      volumeMounts: [
        { path: "/buildkite/bun-cache", volume: bunCache },
        { path: "/buildkite/bun-cache-control", volume: bunCacheControl },
        { path: "/buildkite/uv-cache", volume: uvCache },
        { path: "/buildkite/trivy-db", volume: trivyDb },
        { path: "/buildkite/maintenance", volume: gcScript, readOnly: true },
        // Kometa writes logs and cache beside config.yml. Keep its state
        // writable and project only the declarative configuration read-only.
        { path: "/etc/kometa", volume: kometaState },
        {
          path: "/tmp",
          volume: Volume.fromEmptyDir(chart, "temporal-maintenance-tmp", "tmp"),
        },
      ],
    }),
  );
  setRevisionHistoryLimit(deployment, 5);

  new Service(chart, "temporal-maintenance-worker-metrics-service", {
    metadata: {
      name: "temporal-maintenance-worker-metrics",
      namespace: NAMESPACE,
      labels: { app: "temporal-maintenance-worker-metrics" },
    },
    selector: deployment,
    ports: [{ name: "metrics", port: 9464 }],
  });
  createServiceMonitor(chart, {
    name: "temporal-maintenance-worker-metrics",
    namespace: NAMESPACE,
    matchLabels: { app: "temporal-maintenance-worker-metrics" },
  });
  new Service(chart, "temporal-maintenance-worker-app-metrics-service", {
    metadata: {
      name: "temporal-maintenance-worker-app-metrics",
      namespace: NAMESPACE,
      labels: { app: "temporal-maintenance-worker-app-metrics" },
    },
    selector: deployment,
    ports: [{ name: "app-metrics", port: 9465, targetPort: 9465 }],
  });
  createServiceMonitor(chart, {
    name: "temporal-maintenance-worker-app-metrics",
    namespace: NAMESPACE,
    port: "app-metrics",
    matchLabels: { app: "temporal-maintenance-worker-app-metrics" },
  });
}
