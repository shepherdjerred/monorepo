import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Capability,
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  SeccompProfileType,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/service-monitor.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export const FLIPT_PORT = 8080;

// The image declares no ENTRYPOINT and `CMD ["/flipt","server"]`, so Kubernetes
// `args` alone would try to exec the flag as a binary. The full command is
// restated here. Verified against flipt/flipt:v2.11.0.
const FLIPT_COMMAND = [
  "/flipt",
  "server",
  "--config",
  "/etc/flipt/config.yml",
] as const;

// The image's `flipt` user is uid 100 / gid 1000 — NOT 1000/1000 like most of
// our first-party images. /var/opt/flipt ships owned by flipt:flipt, so running
// as 1000 would fail to write the git repo.
const FLIPT_UID = 100;
const FLIPT_GID = 1000;

const DATA_PATH = "/var/opt/flipt";

// `version: "2.0"` is required — Flipt v2 rejects "1.0" with
// `loading configuration: invalid version: 1.0` and refuses to start.
//
// The storage block is the load-bearing part. Flipt v2 defaults to IN-MEMORY
// storage: without an explicit local backend it happily accepts flag writes and
// silently loses every one of them on restart. Verified by creating a flag,
// restarting the container, and getting a 404 from the evaluation snapshot.
// With this config the same test round-trips, and a bare git repo materialises
// at `${DATA_PATH}/data`.
//
// check_for_updates and telemetry_enabled both default to true and would fail
// continuously against the DNS-only egress policy below.
const FLIPT_CONFIG = `version: "2.0"
log:
  level: info
  encoding: json
server:
  host: 0.0.0.0
  http_port: ${FLIPT_PORT.toString()}
storage:
  default:
    backend:
      type: local
      path: ${DATA_PATH}/data
  beta:
    backend:
      type: local
      path: ${DATA_PATH}/data-beta
  prod:
    backend:
      type: local
      path: ${DATA_PATH}/data-prod
environments:
  default:
    name: default
    default: true
    storage: default
  beta:
    name: beta
    storage: beta
  prod:
    name: prod
    storage: prod
authentication:
  required: false
metrics:
  enabled: true
  exporter: prometheus
ui:
  enabled: true
meta:
  check_for_updates: false
  telemetry_enabled: false
  state_directory: ${DATA_PATH}/state
`;

export function createEnvironmentMigrationScript(dataPath: string): string {
  return `set -eu

source_repo="${dataPath}/data"

validate_repo() {
  repo="$1"
  if [ ! -f "$repo/HEAD" ] || [ ! -f "$repo/config" ] || [ ! -d "$repo/objects" ]; then
    echo "Flipt repository is missing or structurally invalid: $repo" >&2
    exit 1
  fi
}

copy_environment() {
  destination="$1"
  if [ -e "$destination" ]; then
    validate_repo "$destination"
    return
  fi

  cp -a "$source_repo" "$destination"
  diff -qr "$source_repo" "$destination"
}

validate_repo "$source_repo"
copy_environment "${dataPath}/data-beta"
copy_environment "${dataPath}/data-prod"
`;
}

const MIGRATE_ENVIRONMENTS_SCRIPT = createEnvironmentMigrationScript(DATA_PATH);

export function createFliptDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "flipt", {
    metadata: { labels: { app: "flipt" } },
    replicas: 1,
    // Single git working tree on a ReadWriteOnce volume — two pods would race
    // the same repo, so never run old and new together.
    strategy: DeploymentStrategy.recreate(),
    securityContext: { fsGroup: FLIPT_GID },
  });

  const config = new ConfigMap(chart, "flipt-config", {
    data: { "config.yml": FLIPT_CONFIG },
  });

  deployment.podMetadata.addAnnotation(
    "config-hash",
    new Bun.CryptoHasher("sha256")
      .update(FLIPT_CONFIG)
      .digest("hex")
      .slice(0, 12),
  );

  const dataVolume = new ZfsNvmeVolume(chart, "flipt-data", {
    storage: Size.gibibytes(2),
  });

  const persistentDataVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "flipt-data-volume",
    dataVolume.claim,
  );

  deployment.addInitContainer(
    withCommonProps({
      name: "migrate-environments",
      image: `flipt/flipt:${versions["flipt-io/flipt"]}`,
      command: ["/bin/sh", "-c"],
      args: [MIGRATE_ENVIRONMENTS_SCRIPT],
      resources: {
        cpu: { request: Cpu.millis(5), limit: Cpu.millis(50) },
        memory: { request: Size.mebibytes(8), limit: Size.mebibytes(32) },
      },
      securityContext: {
        user: FLIPT_UID,
        group: FLIPT_GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        privileged: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      volumeMounts: [{ path: DATA_PATH, volume: persistentDataVolume }],
    }),
  );

  deployment.addContainer(
    withCommonProps({
      name: "flipt",
      image: `flipt/flipt:${versions["flipt-io/flipt"]}`,
      command: [...FLIPT_COMMAND],
      ports: [{ name: "http", number: FLIPT_PORT }],
      resources: {
        cpu: { request: Cpu.millis(25), limit: Cpu.millis(500) },
        memory: { request: Size.mebibytes(128), limit: Size.mebibytes(512) },
      },
      securityContext: {
        user: FLIPT_UID,
        group: FLIPT_GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
        privileged: false,
        capabilities: { drop: [Capability.ALL] },
        seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
      },
      startup: Probe.fromHttpGet("/health", {
        port: FLIPT_PORT,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 18,
      }),
      liveness: Probe.fromHttpGet("/health", {
        port: FLIPT_PORT,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/health", {
        port: FLIPT_PORT,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      envVariables: {
        // Everything Flipt writes lands under DATA_PATH, but HOME is redirected
        // to the scratch volume so a stray write cannot hit the read-only root.
        HOME: EnvValue.fromValue("/tmp"),
      },
      volumeMounts: [
        {
          path: DATA_PATH,
          volume: persistentDataVolume,
        },
        {
          path: "/etc/flipt",
          volume: Volume.fromConfigMap(chart, "flipt-config-volume", config),
        },
        {
          path: "/tmp",
          volume: Volume.fromEmptyDir(chart, "flipt-tmp-volume", "tmp"),
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "flipt-service", {
    metadata: { labels: { app: "flipt" } },
    selector: deployment,
    // gRPC (9000) is deliberately not exposed: the JS client is REST-only.
    ports: [{ name: "http", port: FLIPT_PORT }],
  });

  createServiceMonitor(chart, {
    name: "flipt",
    port: "http",
    namespace: "flipt",
    matchLabels: { app: "flipt" },
  });

  new TailscaleIngress(chart, "flipt-ingress", {
    service,
    host: "flipt",
    probePath: "/health",
  });

  return deployment;
}
