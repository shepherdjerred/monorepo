import type { Chart } from "cdk8s";
import {
  KubeConfigMap,
  KubePersistentVolumeClaim,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";

export const BUN_CACHE_MOUNT_PATH = "/buildkite/bun-cache";

const BUN_CACHE_GC_SCRIPT = await Bun.file(
  new URL("buildkite-bun-cache-gc.sh", import.meta.url),
).text();
if (BUN_CACHE_GC_SCRIPT.length === 0) {
  throw new Error("buildkite-bun-cache-gc.sh must not be empty");
}

export function createBuildkiteBunCache(chart: Chart): void {
  // The cache is disposable derived data. Coordination lives on a separate
  // volume so a full data filesystem cannot prevent the collector from taking
  // its exclusive lock.
  new KubePersistentVolumeClaim(chart, "buildkite-bun-cache-pvc", {
    metadata: {
      name: "buildkite-bun-cache",
      namespace: "buildkite",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: NVME_STORAGE_CLASS_LZ4,
      resources: { requests: { storage: Quantity.fromString("60Gi") } },
    },
  });

  new KubePersistentVolumeClaim(chart, "buildkite-bun-cache-control-pvc", {
    metadata: {
      name: "buildkite-bun-cache-control",
      namespace: "buildkite",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: NVME_STORAGE_CLASS_LZ4,
      resources: { requests: { storage: Quantity.fromString("1Gi") } },
    },
  });

  new KubeConfigMap(chart, "buildkite-bun-cache-gc-config", {
    metadata: {
      name: "buildkite-bun-cache-gc",
      namespace: "buildkite",
    },
    data: {
      "bun-cache-gc.sh": BUN_CACHE_GC_SCRIPT,
    },
  });
}
