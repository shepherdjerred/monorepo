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
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    metadata: { name: WORKER_NAME, namespace: NAMESPACE },
    podMetadata: { labels: WORKER_LABELS },
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

  deployment.addContainer(
    withCommonProps({
      name: WORKER_NAME,
      image: `ghcr.io/shepherdjerred/temporal-worker:${versions["shepherdjerred/temporal-worker"]}`,
      ports: [
        { name: "metrics", number: 9464 },
        { name: "app-metrics", number: 9465 },
      ],
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
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
        {
          path: "/etc/kometa",
          volume: kometaConfig,
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
