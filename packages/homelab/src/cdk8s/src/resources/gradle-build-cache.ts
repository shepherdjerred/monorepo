import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EmptyDirMedium,
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

// Gradle's HttpBuildCache needs only GET and PUT of opaque entries, which
// nginx's WebDAV module serves from the claim. Gradle's standalone build
// cache node is end-of-life after 2026-12-31, and its successor needs a paid
// Develocity installation.
const PORT = 8080;
const DATA_PATH = "/data";
const AUTH_PATH = "/run/nginx-auth";
// The image's `nginx` user. fsGroup makes a fresh claim writable by it.
const APP_UID = 101;
// Cache entries are derived build outputs: a lost claim costs one cold build
// per module, so the claim is unbacked-up. A complete cold `gradle -p plugin
// test` stored 249 entries totalling 34 MiB (largest 7 MiB), so the claim
// holds hundreds of full builds.
const CACHE_PVC_SIZE = Size.gibibytes(16);
// Gradle stores each entry once per cache key and never rewrites it, so the
// modification time is when the entry was stored. Every pod start (image
// bumps included) drops entries older than this; a hot entry that is dropped
// is stored again by the next default-branch build that needs it. Between
// starts the generic PVC usage and projected-fill alerts cover the claim.
const ENTRY_MAX_AGE_DAYS = 30;
// Gradle's own default upper bound for a stored entry.
const MAX_ENTRY_SIZE = "100m";

/** Users whose password may store entries, and users who may only load. */
const writers = Object.values(GRADLE_BUILD_CACHE_USERS).filter(
  ({ level }) => level === "readwrite",
);

/**
 * nginx serving the cache under `/cache/`.
 *
 * Every cache request authenticates. Loads accept either CI user; any other
 * method is checked against the writers file only, so the read user cannot
 * store, overwrite, or otherwise mutate an entry. A PUT lands in a temporary
 * file on the claim and is renamed into place, so readers never see a
 * partial entry. `/healthz` answers without credentials and reveals nothing.
 */
export function gradleBuildCacheNginxConfig(
  dataPath = DATA_PATH,
  authPath = AUTH_PATH,
): string {
  return String.raw`worker_processes 2;
pid /tmp/nginx.pid;
error_log stderr warn;

events {
  worker_connections 512;
}

http {
  server_tokens off;
  sendfile on;
  tcp_nopush on;
  default_type application/octet-stream;

  client_body_temp_path ${dataPath}/.upload;
  proxy_temp_path /tmp/proxy;
  fastcgi_temp_path /tmp/fastcgi;
  uwsgi_temp_path /tmp/uwsgi;
  scgi_temp_path /tmp/scgi;

  # Hits, stores, and misses are routine; log only failures.
  map $status $failed {
    ~^[23] 0;
    404 0;
    default 1;
  }
  access_log /dev/stdout combined if=$failed;

  server {
    listen ${String(PORT)};

    location = /healthz {
      access_log off;
      default_type text/plain;
      return 200 "ok\n";
    }

    location /cache/ {
      root ${dataPath};
      auth_basic "Gradle build cache";
      auth_basic_user_file ${authPath}/users;
      limit_except GET HEAD {
        auth_basic_user_file ${authPath}/writers;
      }
      dav_methods PUT;
      create_full_put_path on;
      dav_access user:rw;
      client_max_body_size ${MAX_ENTRY_SIZE};
      # A miss is an ordinary 404 to Gradle, not an error.
      log_not_found off;
    }

    location / {
      return 404;
    }
  }
}
`;
}

/**
 * Prepare the pod: write the htpasswd files and evict stale entries.
 *
 * Passwords are hashed with SHA-512 crypt by BusyBox `cryptpw`, read on
 * stdin so they never appear in a process argument list, and only the hashes
 * reach the in-memory auth volume.
 */
export function gradleBuildCachePrepareScript(
  dataPath = DATA_PATH,
  authPath = AUTH_PATH,
): string {
  const users = Object.values(GRADLE_BUILD_CACHE_USERS);
  // An empty field would otherwise hash to a valid, guessable password.
  const required = users.map(
    ({ passwordKey: key }) => `: "\${${key}:?${key} is empty}"`,
  );
  const line = ({ username, passwordKey }: (typeof users)[number]) =>
    `entry ${username} "$${passwordKey}"`;
  return String.raw`set -eu
umask 077
${required.join("\n")}
entry() {
  hash="$(printf '%s\n' "$2" | cryptpw -m sha512 -P 0)"
  case "$hash" in
    '$6$'*) ;;
    *) echo "cryptpw did not return a SHA-512 crypt hash for $1" >&2; exit 1 ;;
  esac
  printf '%s:%s\n' "$1" "$hash"
}
{
${users.map((user) => `  ${line(user)}`).join("\n")}
} > "${authPath}/users"
{
${writers.map((user) => `  ${line(user)}`).join("\n")}
} > "${authPath}/writers"
mkdir -p "${dataPath}/cache" "${dataPath}/.upload"
find "${dataPath}/.upload" -mindepth 1 -delete
find "${dataPath}/cache" -type f -mtime +${String(ENTRY_MAX_AGE_DAYS)} -delete`;
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

  const nginxConfig = gradleBuildCacheNginxConfig();
  const config = new ConfigMap(chart, "gradle-build-cache-nginx", {
    data: { "nginx.conf": nginxConfig },
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
  // The config is mounted by subPath, which never reloads; roll the pod
  // when it changes.
  deployment.podMetadata.addAnnotation(
    "config-hash",
    new Bun.CryptoHasher("sha256")
      .update(nginxConfig)
      .digest("hex")
      .slice(0, 12),
  );
  // Next to its only clients, CI step pods on liskov.
  deployment.scheduling.attract(
    Node.labeled(NodeLabelQuery.is("kubernetes.io/hostname", CI_NODE_HOSTNAME)),
  );
  deployment.scheduling.tolerate(ciNodeTaintedNode());

  const image = `nginx:${versions["library/nginx"]}`;
  const securityContext = { user: APP_UID, group: APP_UID };
  const dataVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "gradle-build-cache-volume",
    cache,
  );
  const authVolume = Volume.fromEmptyDir(
    chart,
    "gradle-build-cache-auth",
    "auth",
    { medium: EmptyDirMedium.MEMORY, sizeLimit: Size.mebibytes(1) },
  );
  const configVolume = Volume.fromConfigMap(
    chart,
    "gradle-build-cache-config",
    config,
  );
  const tmpVolume = Volume.fromEmptyDir(chart, "gradle-build-cache-tmp", "tmp");

  deployment.addInitContainer(
    withCommonProps({
      name: "prepare",
      image,
      command: ["/bin/sh", "-c"],
      args: [gradleBuildCachePrepareScript()],
      securityContext,
      envVariables: Object.fromEntries(
        Object.values(GRADLE_BUILD_CACHE_USERS).map(({ passwordKey }) => [
          passwordKey,
          EnvValue.fromSecretValue({ secret: secretRef, key: passwordKey }),
        ]),
      ),
      resources: {
        cpu: { request: Cpu.millis(10), limit: Cpu.millis(500) },
        memory: { request: Size.mebibytes(16), limit: Size.mebibytes(64) },
      },
      volumeMounts: [
        { path: DATA_PATH, volume: dataVolume },
        { path: AUTH_PATH, volume: authVolume },
      ],
    }),
  );

  deployment.addContainer(
    withCommonProps({
      name: "gradle-build-cache",
      image,
      // Skip the image entrypoint's config templating; the config is fixed.
      command: ["nginx", "-g", "daemon off;"],
      ports: [{ name: "http", number: PORT }],
      securityContext,
      resources: {
        cpu: { request: Cpu.millis(50), limit: Cpu.millis(1000) },
        memory: { request: Size.mebibytes(32), limit: Size.mebibytes(256) },
      },
      volumeMounts: [
        { path: DATA_PATH, volume: dataVolume },
        { path: AUTH_PATH, volume: authVolume, readOnly: true },
        {
          path: "/etc/nginx/nginx.conf",
          subPath: "nginx.conf",
          volume: configVolume,
          readOnly: true,
        },
        { path: "/tmp", volume: tmpVolume },
      ],
      readiness: Probe.fromHttpGet("/healthz", {
        port: PORT,
        periodSeconds: Duration.seconds(10),
      }),
      liveness: Probe.fromHttpGet("/healthz", {
        port: PORT,
        initialDelaySeconds: Duration.seconds(10),
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
    probePath: "/healthz",
  });

  return { deployment, service, secrets, cache, config };
}
