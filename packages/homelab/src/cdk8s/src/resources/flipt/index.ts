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
import { renderFliptFeatures } from "@shepherdjerred/feature-flags/flipt-features-renderer.ts";
import {
  managedFlagInventory,
  managedFlagNamespaces,
} from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";

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
const FLIPT_SECURITY_CONTEXT = {
  user: FLIPT_UID,
  group: FLIPT_GID,
  ensureNonRoot: true,
  readOnlyRootFilesystem: true,
  allowPrivilegeEscalation: false,
  privileged: false,
  capabilities: { drop: [Capability.ALL] },
  seccompProfile: { type: SeccompProfileType.RUNTIME_DEFAULT },
};
const FLIPT_INIT_RESOURCES = {
  cpu: { request: Cpu.millis(5), limit: Cpu.millis(50) },
  memory: { request: Size.mebibytes(8), limit: Size.mebibytes(32) },
};

const DATA_PATH = "/var/opt/flipt";
const REPOSITORY_DATA_PATH = `${DATA_PATH}/repositories`;
const SEED_WORK_PATH = "/tmp/flipt-seed";

const FLIPT_SEED_DATA = Object.fromEntries(
  managedFlagInventory.environments.flatMap((environment) =>
    managedFlagNamespaces.map((namespace) => [
      `${environment.key}.${namespace}.yaml`,
      renderFliptFeatures(environment.key, namespace),
    ]),
  ),
);

// `version: "2.0"` is required — Flipt v2 rejects "1.0" with
// `loading configuration: invalid version: 1.0` and refuses to start.
//
// The storage block is the load-bearing part. Flipt v2 defaults to IN-MEMORY
// storage: without an explicit local backend it happily accepts flag writes and
// silently loses every one of them on restart. Verified by creating a flag,
// restarting the container, and getting a 404 from the evaluation snapshot.
// With this config the same test round-trips, and each managed environment has
// its own normal git repository. The product namespace seed is validated and
// committed before first boot into the clean repository paths below; existing
// repositories are never overwritten on later restarts.
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
  beta:
    branch: main
    backend:
      type: local
      path: ${REPOSITORY_DATA_PATH}/beta
  prod:
    branch: main
    backend:
      type: local
      path: ${REPOSITORY_DATA_PATH}/prod
environments:
  beta:
    name: beta
    storage: beta
  prod:
    name: prod
    default: true
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

export function createSeedValidationScript(
  namespaces: readonly string[],
): string {
  const copyCommands = ["beta", "prod"].flatMap((environment) =>
    namespaces.map(
      (namespace) =>
        `mkdir -p "$work_root/${environment}/${namespace}"\ncp "/etc/flipt-seed/${environment}.${namespace}.yaml" "$work_root/${environment}/${namespace}/features.yaml"`,
    ),
  );
  return `set -eu

work_root="${SEED_WORK_PATH}"
mkdir -p "$work_root/beta" "$work_root/prod"
${copyCommands.join("\n")}

validate_environment() {
  environment="$1"
  seed="$work_root/$environment"

  /flipt validate --work-dir "$seed"
}

validate_environment beta
validate_environment prod
`;
}

export function createRepositoryInitializationScript(
  dataPath: string,
  namespaces: readonly string[],
  workRoot = SEED_WORK_PATH,
): string {
  const trackedPaths = namespaces.map(
    (namespace) => `"${namespace}/features.yaml"`,
  );
  return `set -eu

validate_repository() {
  candidate="$1"
  if [ ! -d "$candidate/.git" ]; then
    echo "Flipt repository is not a normal Git repository: $candidate" >&2
    exit 1
  fi
  git -C "$candidate" show-ref --verify --quiet refs/heads/main
  git -C "$candidate" cat-file -e 'refs/heads/main^{commit}'
}

initialize_environment() {
  environment="$1"
  repo="${dataPath}/repositories/$environment"
  staging="$repo.initializing"
  seed="${workRoot}/$environment"

  if [ -e "$repo" ]; then
    validate_repository "$repo"
    return
  fi
  if [ -e "$staging" ]; then
    echo "Stale Flipt repository initialization directory: $staging" >&2
    exit 1
  fi

  mkdir -p "$staging"
  cp -R "$seed/." "$staging/"
  git -C "$staging" init --initial-branch=main
  git -C "$staging" config user.name "Flipt seed initializer"
  git -C "$staging" config user.email "flipt-seed@localhost"
  git -C "$staging" add -- ${trackedPaths.join(" ")}
  git -C "$staging" commit --message "Seed managed feature flags"
  validate_repository "$staging"
  mv "$staging" "$repo"
}

mkdir -p "${dataPath}/repositories"
initialize_environment beta
initialize_environment prod
`;
}

const VALIDATE_SEEDS_SCRIPT = createSeedValidationScript(managedFlagNamespaces);
const INITIALIZE_REPOSITORIES_SCRIPT = createRepositoryInitializationScript(
  DATA_PATH,
  managedFlagNamespaces,
);

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
  const seed = new ConfigMap(chart, "flipt-seed", {
    data: FLIPT_SEED_DATA,
  });

  deployment.podMetadata.addAnnotation(
    "config-hash",
    new Bun.CryptoHasher("sha256")
      .update(`${FLIPT_CONFIG}\n${JSON.stringify(FLIPT_SEED_DATA)}`)
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
  const scratchVolume = Volume.fromEmptyDir(chart, "flipt-tmp-volume", "tmp");
  const seedVolume = Volume.fromConfigMap(chart, "flipt-seed-volume", seed);

  deployment.addInitContainer(
    withCommonProps({
      name: "validate-environment-seeds",
      image: `flipt/flipt:${versions["flipt-io/flipt"]}`,
      command: ["/bin/sh", "-c"],
      args: [VALIDATE_SEEDS_SCRIPT],
      resources: FLIPT_INIT_RESOURCES,
      securityContext: FLIPT_SECURITY_CONTEXT,
      volumeMounts: [
        { path: "/etc/flipt-seed", volume: seedVolume, readOnly: true },
        { path: "/tmp", volume: scratchVolume },
      ],
    }),
  );

  deployment.addInitContainer(
    withCommonProps({
      name: "initialize-environment-repositories",
      image: `docker.io/alpine/git:${versions["alpine/git"]}`,
      command: ["/bin/sh", "-c"],
      args: [INITIALIZE_REPOSITORIES_SCRIPT],
      resources: FLIPT_INIT_RESOURCES,
      securityContext: FLIPT_SECURITY_CONTEXT,
      envVariables: { HOME: EnvValue.fromValue("/tmp") },
      volumeMounts: [
        { path: DATA_PATH, volume: persistentDataVolume },
        { path: "/tmp", volume: scratchVolume },
      ],
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
      securityContext: FLIPT_SECURITY_CONTEXT,
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
          volume: scratchVolume,
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
