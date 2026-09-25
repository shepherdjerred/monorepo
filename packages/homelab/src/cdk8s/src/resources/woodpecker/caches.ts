import type { Chart } from "cdk8s";
import {
  KubeConfigMap,
  KubePersistentVolumeClaim,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

/**
 * Shared package caches for CI step pods.
 *
 * Steps mount these by claim name through `volumes` in their generated
 * workflow. All of it is disposable derived data that can be rebuilt from the
 * lockfile, so none of it is backed up — but it sits on the CI node's NVMe
 * because a cold install is the single largest avoidable cost in a build.
 *
 * ReadWriteMany because many step pods mount the same claim concurrently.
 */

export const WOODPECKER_BUN_CACHE_CLAIM = "woodpecker-bun-cache";
export const WOODPECKER_BUN_CACHE_PATH = "/woodpecker/bun-cache";
/**
 * Coordination volume for the Bun cache collector.
 *
 * Deliberately a separate claim: the collector takes its exclusive lock here
 * before clearing the cache, and a lock file on a full data filesystem is a
 * lock the collector cannot take — exactly when it is most needed.
 */
export const WOODPECKER_BUN_CACHE_CONTROL_CLAIM =
  "woodpecker-bun-cache-control";
export const WOODPECKER_BUN_CACHE_CONTROL_PATH =
  "/woodpecker/bun-cache-control";
export const WOODPECKER_BUN_CACHE_GC_CONFIG_MAP = "woodpecker-bun-cache-gc";
export const WOODPECKER_UV_CACHE_CLAIM = "woodpecker-uv-cache";
export const WOODPECKER_UV_CACHE_PATH = "/woodpecker/uv-cache";
export const WOODPECKER_TOFU_PLUGIN_CACHE_CLAIM =
  "woodpecker-tofu-plugin-cache";
export const WOODPECKER_TOFU_PLUGIN_CACHE_PATH =
  "/woodpecker/tofu-plugin-cache";
export const WOODPECKER_TRIVY_DB_CLAIM = "woodpecker-trivy-db";
export const WOODPECKER_TRIVY_DB_PATH = "/woodpecker/trivy-db";
export const WOODPECKER_CODEX_AUTH_CLAIM = "woodpecker-codex-auth";
export const WOODPECKER_CODEX_AUTH_PATH = "/woodpecker/codex-auth";

const DISPOSABLE_CACHE_LABELS = {
  "velero.io/backup": "disabled",
  "velero.io/exclude-from-backup": "true",
} as const;

function createCacheClaim(
  chart: Chart,
  id: string,
  name: string,
  size: string,
): void {
  new KubePersistentVolumeClaim(chart, id, {
    metadata: {
      name,
      namespace: WOODPECKER_CI_NAMESPACE,
      labels: DISPOSABLE_CACHE_LABELS,
    },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: NVME_STORAGE_CLASS_LZ4,
      resources: { requests: { storage: Quantity.fromString(size) } },
    },
  });
}

const BUN_CACHE_GC_SCRIPT = await Bun.file(
  new URL("bun-cache-gc.sh", import.meta.url),
).text();
if (BUN_CACHE_GC_SCRIPT.length === 0) {
  throw new Error("bun-cache-gc.sh must not be empty");
}

export function createWoodpeckerCaches(chart: Chart): void {
  // Sized to match the Woodpecker bun cache it replaces; the working set is the
  // whole workspace's dependency closure, not one package's.
  createCacheClaim(
    chart,
    "woodpecker-bun-cache-pvc",
    WOODPECKER_BUN_CACHE_CLAIM,
    "60Gi",
  );

  createCacheClaim(
    chart,
    "woodpecker-bun-cache-control-pvc",
    WOODPECKER_BUN_CACHE_CONTROL_CLAIM,
    "1Gi",
  );

  // The collector itself, mounted into the maintenance worker rather than
  // baked into its image: the worker image is shared with every other Temporal
  // role, and this script is specific to this one cache.
  new KubeConfigMap(chart, "woodpecker-bun-cache-gc-config", {
    metadata: {
      name: WOODPECKER_BUN_CACHE_GC_CONFIG_MAP,
      namespace: WOODPECKER_CI_NAMESPACE,
    },
    data: { "bun-cache-gc.sh": BUN_CACHE_GC_SCRIPT },
  });

  // uv's artifact cache is safe for concurrent readers and writers, unlike a
  // virtual environment; only downloads and build artifacts live here and each
  // job keeps its own .venv in the disposable workspace.
  createCacheClaim(
    chart,
    "woodpecker-uv-cache-pvc",
    WOODPECKER_UV_CACHE_CLAIM,
    "20Gi",
  );

  // OpenTofu provider archives are deterministic but expensive to download.
  // The plugin-cache protocol has no concurrent-writer support, so lanes take
  // an advisory lock in this directory before invoking tofu -- which is why it
  // is ReadWriteMany even though only one writer is ever active. No state or
  // build output is stored here.
  createCacheClaim(
    chart,
    "woodpecker-tofu-plugin-cache-pvc",
    WOODPECKER_TOFU_PLUGIN_CACHE_CLAIM,
    "10Gi",
  );

  // Trivy's vulnerability database. The scan runs with --skip-db-update so a
  // pull-request lane never waits on a database download; something must
  // therefore supply the database, and this is it.
  createCacheClaim(
    chart,
    "woodpecker-trivy-db-pvc",
    WOODPECKER_TRIVY_DB_CLAIM,
    "5Gi",
  );

  // Codex's ChatGPT-managed auth bundle includes a refresh token, so it has to
  // survive the review gate's ephemeral pods. Never backed up: recover it by
  // re-seeding from a fresh `codex login` on the trusted operator machine,
  // never from a snapshot of a live credential.
  createCacheClaim(
    chart,
    "woodpecker-codex-auth-pvc",
    WOODPECKER_CODEX_AUTH_CLAIM,
    "1Gi",
  );
}
