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
/**
 * Toolchain caches that otherwise land in the step container's home directory
 * on the CI node's OS disk. Mount paths and the environment that directs each
 * tool at them live in packages/woodpecker-config-extension/src/pipeline/cache.ts.
 */
export const WOODPECKER_CARGO_CACHE_CLAIM = "woodpecker-cargo-cache";
export const WOODPECKER_SCCACHE_CLAIM = "woodpecker-sccache";
export const WOODPECKER_GO_CACHE_CLAIM = "woodpecker-go-cache";
export const WOODPECKER_TOOL_CACHE_CLAIM = "woodpecker-tool-cache";
export const WOODPECKER_GRADLE_HOME_CLAIM = "woodpecker-gradle-home";

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
const SOURCE_CACHE_GC_SCRIPT = await Bun.file(
  new URL("source-cache-gc.ts", import.meta.url),
).text();
if (BUN_CACHE_GC_SCRIPT.length === 0) {
  throw new Error("bun-cache-gc.sh must not be empty");
}

export function createWoodpeckerCaches(chart: Chart): void {
  createCacheClaim(
    chart,
    "woodpecker-format-main-pvc",
    "woodpecker-format-main",
    "128Mi",
  );
  createCacheClaim(
    chart,
    "woodpecker-format-pr-pvc",
    "woodpecker-format-pr",
    "128Mi",
  );
  createCacheClaim(
    chart,
    "woodpecker-workspace-seeds-pvc",
    "woodpecker-workspace-seeds",
    "60Gi",
  );
  createCacheClaim(
    chart,
    "woodpecker-source-main-pvc",
    "woodpecker-source-main",
    "20Gi",
  );
  createCacheClaim(
    chart,
    "woodpecker-source-pr-pvc",
    "woodpecker-source-pr",
    "20Gi",
  );
  createCacheClaim(
    chart,
    "woodpecker-source-control-pvc",
    "woodpecker-source-control",
    "1Gi",
  );
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
    data: {
      "bun-cache-gc.sh": BUN_CACHE_GC_SCRIPT,
      "source-cache-gc.ts": SOURCE_CACHE_GC_SCRIPT,
    },
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
  // never from a snapshot of a live credential. liskov's pool runs
  // sync=disabled, so a recreated claim must have its dataset pinned back to
  // sync=standard (src/talos/liskov/README.md).
  createCacheClaim(
    chart,
    "woodpecker-codex-auth-pvc",
    WOODPECKER_CODEX_AUTH_CLAIM,
    "1Gi",
  );

  // Toolchain caches. A verify pod measured on 2026-10-12 still wrote about
  // 1.7 GB per run into its writable layer after TMPDIR moved: Cargo's
  // registry, Go's module and build caches, Bun's install root for bunx, mise
  // and uv tool installs, NuGet packages and XDG-cached engine downloads. Each
  // family gets its own dataset so a quota hit stays local to that tool, and
  // none has a collector: Cargo, Go, Gradle and sccache expire or bound their
  // own caches, and ZfsPVCStorageHigh covers the rest. Same trust class as the
  // Bun cache: the trusted graph shares them across PR and main runs; the
  // credentialless graph mounts none.
  createCacheClaim(
    chart,
    "woodpecker-cargo-cache-pvc",
    WOODPECKER_CARGO_CACHE_CLAIM,
    "30Gi",
  );
  // sccache keeps itself under SCCACHE_CACHE_SIZE (30G); the quota is headroom.
  createCacheClaim(
    chart,
    "woodpecker-sccache-pvc",
    WOODPECKER_SCCACHE_CLAIM,
    "40Gi",
  );
  createCacheClaim(
    chart,
    "woodpecker-go-cache-pvc",
    WOODPECKER_GO_CACHE_CLAIM,
    "30Gi",
  );
  createCacheClaim(
    chart,
    "woodpecker-tool-cache-pvc",
    WOODPECKER_TOOL_CACHE_CLAIM,
    "10Gi",
  );
  // Gradle's user home is designed for concurrent builds (file-locked
  // dependency cache, per-process daemon registry) and expires unused entries
  // after 30 days. Replaces the per-workflow /woodpecker/gradle directory,
  // which re-downloaded ~1.4 GB of distributions and dependencies per run.
  createCacheClaim(
    chart,
    "woodpecker-gradle-home-pvc",
    WOODPECKER_GRADLE_HOME_CLAIM,
    "20Gi",
  );
}
