import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  FsGroupChangePolicy,
  Node,
  NodeLabelQuery,
  PersistentVolumeAccessMode,
  PersistentVolumeClaim,
  PersistentVolumeMode,
  Probe,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import {
  CI_NODE_HOSTNAME,
  ciNodeTaintedNode,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { CI_GRADLE_BUILD_CACHE_ITEM } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import { GRADLE_BUILD_CACHE_USERS } from "@shepherdjerred/woodpecker-config-extension/src/pipeline/gradle-build-cache.ts";

export const GRADLE_BUILD_CACHE_NAMESPACE = "gradle-build-cache";

// The node serves its HTTP cache (and /ping) on 5071. Its Bazel gRPC port
// (6011) is not exposed: only Gradle uses this node.
const PORT = 5071;
const DATA_PATH = "/data";
const CONFIG_PATH = "/config";
// The image declares no user. Any non-root uid works once fsGroup makes the
// fresh claim group-writable.
const APP_UID = 999;
// Cache entries are derived build outputs: a lost claim costs one cold build
// per module, so the claim is unbacked-up. A complete cold `gradle -p plugin
// test` stored 249 entries totalling 34 MiB (largest 7 MiB), so the target
// holds hundreds of full builds. The node evicts least recently used entries
// above it, leaving room for logs and in-flight uploads below the quota. Its
// 100 MiB per-entry default stays.
const CACHE_PVC_SIZE = Size.gibibytes(16);
const TARGET_SIZE_MIB = 12 * 1024;

/**
 * Write the node's config file from the CI cache item.
 *
 * The node accepts only salted password hashes, so the passwords are hashed
 * here by the node's own `hash` command and never written in clear text.
 * The config file must stay writable because the node rewrites it, so it is
 * rendered into an emptyDir rather than mounted from the Secret. Access is
 * credentialed only: no anonymous level and no configuration UI.
 */
export function gradleBuildCacheConfigScript(configPath = CONFIG_PATH): string {
  const users = Object.values(GRADLE_BUILD_CACHE_USERS);
  // An empty field would otherwise hash to a valid, guessable password.
  // `hash` prints the quoted "salt:hash" string the config file expects.
  const hashes = users.map(
    ({ passwordKey: key }) => `: "\${${key}:?${key} is empty}"
${key}_HASH="$(echo "$${key}" | build-cache-node hash --password -)"
case "$${key}_HASH" in
  '"'*:*'"') ;;
  *) echo "build-cache-node did not return a password hash for ${key}" >&2; exit 1 ;;
esac`,
  );
  const entries = users.map(
    ({ username, passwordKey, level }) => `      ${username}:
        password: $${passwordKey}_HASH
        level: "${level}"`,
  );
  return `set -eu
umask 077
${hashes.join("\n")}
cat > "${configPath}/config.yaml" <<EOF
version: 5
cache:
  targetSize:
    type: fixed
    size: ${String(TARGET_SIZE_MIB)}
  accessControl:
    anonymousLevel: "none"
    users:
${entries.join("\n")}
uiAccess:
  type: "disabled"
EOF`;
}

export function createGradleBuildCacheDeployment(chart: Chart) {
  const secrets = new OnePasswordItem(chart, "gradle-build-cache-secrets", {
    spec: { itemPath: vaultItemPath(CI_GRADLE_BUILD_CACHE_ITEM) },
    metadata: { name: "gradle-build-cache-secrets" },
  });
  const secretRef = Secret.fromSecretName(
    chart,
    "gradle-build-cache-secrets-ref",
    secrets.name,
  );

  const cache = new PersistentVolumeClaim(chart, "gradle-build-cache-liskov", {
    storageClassName: NVME_STORAGE_CLASS_LZ4,
    accessModes: [PersistentVolumeAccessMode.READ_WRITE_ONCE],
    volumeMode: PersistentVolumeMode.FILE_SYSTEM,
    storage: CACHE_PVC_SIZE,
    metadata: {
      name: "gradle-build-cache-liskov",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
  });

  const deployment = new Deployment(chart, "gradle-build-cache", {
    replicas: 1,
    securityContext: {
      fsGroup: APP_UID,
      // Repairs a fresh claim's root once instead of walking every cache
      // entry on each restart.
      fsGroupChangePolicy: FsGroupChangePolicy.ON_ROOT_MISMATCH,
    },
    // A ReadWriteOnce claim cannot be attached to a surge Pod.
    strategy: DeploymentStrategy.recreate(),
  });
  // Next to its only clients, CI step pods on liskov.
  deployment.scheduling.attract(
    Node.labeled(NodeLabelQuery.is("kubernetes.io/hostname", CI_NODE_HOSTNAME)),
  );
  deployment.scheduling.tolerate(ciNodeTaintedNode());

  const image = `gradle/build-cache-node:${versions["gradle/build-cache-node"]}`;
  const securityContext = { user: APP_UID, group: APP_UID };
  const configVolume = Volume.fromEmptyDir(
    chart,
    "gradle-build-cache-config",
    "config",
  );
  const tmpVolume = Volume.fromEmptyDir(chart, "gradle-build-cache-tmp", "tmp");

  deployment.addInitContainer(
    withCommonProps({
      name: "render-config",
      image,
      command: ["/bin/sh", "-c"],
      args: [gradleBuildCacheConfigScript()],
      securityContext,
      envVariables: {
        // Each `hash` run is a short JVM; keep it inside the limit below.
        JAVA_OPTS: EnvValue.fromValue("-Xmx128m"),
        ...Object.fromEntries(
          Object.values(GRADLE_BUILD_CACHE_USERS).map(({ passwordKey }) => [
            passwordKey,
            EnvValue.fromSecretValue({ secret: secretRef, key: passwordKey }),
          ]),
        ),
      },
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(1000) },
        memory: { request: Size.mebibytes(128), limit: Size.mebibytes(384) },
      },
      volumeMounts: [
        { path: CONFIG_PATH, volume: configVolume },
        { path: "/tmp", volume: tmpVolume },
      ],
    }),
  );

  deployment.addContainer(
    withCommonProps({
      name: "gradle-build-cache",
      image,
      args: [
        "start",
        `--data-dir=${DATA_PATH}`,
        `--config-dir=${CONFIG_PATH}`,
        `--port=${String(PORT)}`,
      ],
      ports: [{ name: "http", number: PORT }],
      securityContext,
      envVariables: {
        // Upstream defaults to a 1 GiB heap plus 500 MiB direct memory. Cache
        // entries stream to disk, so CI's request volume needs less.
        JAVA_OPTS: EnvValue.fromValue(
          "-Xms256m -Xmx768m -XX:MaxDirectMemorySize=256m",
        ),
      },
      resources: {
        cpu: { request: Cpu.millis(100), limit: Cpu.millis(1000) },
        memory: { request: Size.mebibytes(768), limit: Size.mebibytes(1536) },
      },
      volumeMounts: [
        {
          path: DATA_PATH,
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "gradle-build-cache-volume",
            cache,
          ),
        },
        { path: CONFIG_PATH, volume: configVolume },
        { path: "/tmp", volume: tmpVolume },
      ],
      // /ping answers SUCCESS without credentials once the cache is serving.
      readiness: Probe.fromHttpGet("/ping", {
        port: PORT,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(10),
      }),
      liveness: Probe.fromHttpGet("/ping", {
        port: PORT,
        initialDelaySeconds: Duration.seconds(60),
        periodSeconds: Duration.seconds(30),
      }),
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "gradle-build-cache-service", {
    selector: deployment,
    ports: [{ port: PORT, name: "http" }],
  });

  // Internal-only, like turbo-cache: CI step pods reach tailnet services over
  // HTTPS, which is the only egress their network policy allows.
  new TailscaleIngress(chart, "gradle-build-cache-ingress", {
    service,
    host: "gradle-build-cache",
    proxyClass: "medium",
    probePath: "/ping",
  });

  return { deployment, service, secrets, cache };
}
