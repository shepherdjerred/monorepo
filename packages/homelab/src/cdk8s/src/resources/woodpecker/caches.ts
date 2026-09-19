import type { Chart } from "cdk8s";
import {
  KubePersistentVolumeClaim,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import { WOODPECKER_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

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
export const WOODPECKER_UV_CACHE_CLAIM = "woodpecker-uv-cache";
export const WOODPECKER_UV_CACHE_PATH = "/woodpecker/uv-cache";
export const WOODPECKER_TOFU_PLUGIN_CACHE_CLAIM =
  "woodpecker-tofu-plugin-cache";
export const WOODPECKER_TOFU_PLUGIN_CACHE_PATH =
  "/woodpecker/tofu-plugin-cache";

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
      namespace: WOODPECKER_NAMESPACE,
      labels: DISPOSABLE_CACHE_LABELS,
    },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: NVME_STORAGE_CLASS_LZ4,
      resources: { requests: { storage: Quantity.fromString(size) } },
    },
  });
}

export function createWoodpeckerCaches(chart: Chart): void {
  // Sized to match the Buildkite bun cache it replaces; the working set is the
  // whole workspace's dependency closure, not one package's.
  createCacheClaim(
    chart,
    "woodpecker-bun-cache-pvc",
    WOODPECKER_BUN_CACHE_CLAIM,
    "60Gi",
  );

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
}
