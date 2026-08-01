import type { Chart } from "cdk8s";
import {
  KubeConfigMap,
  KubeCronJob,
  KubePersistentVolumeClaim,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import {
  CI_NODE_HOSTNAME,
  CI_NODE_TOLERATION,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";

export const BUN_CACHE_MOUNT_PATH = "/buildkite/bun-cache";
export const BUN_CACHE_DATA_PATH = `${BUN_CACHE_MOUNT_PATH}/data`;
export const BUN_CACHE_CONTROL_PATH = "/buildkite/bun-cache-control";
export const BUN_CACHE_LOCK_PATH = `${BUN_CACHE_CONTROL_PATH}/.gc.lock`;
const BUN_CACHE_GC_THRESHOLD_PERCENT = "60";

const CI_BASE_DIGEST_CONTENT = await Bun.file(
  new URL("ci-base.DIGEST", import.meta.url),
).text();
const CI_BASE_DIGEST = CI_BASE_DIGEST_CONTENT.trim();
if (!/^sha256:[\da-f]{64}$/.test(CI_BASE_DIGEST)) {
  throw new Error("ci-base.DIGEST must contain a canonical sha256 digest");
}

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

  new KubeCronJob(chart, "buildkite-bun-cache-gc", {
    metadata: { name: "buildkite-bun-cache-gc", namespace: "buildkite" },
    spec: {
      schedule: "*/5 * * * *",
      timeZone: "America/Los_Angeles",
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          activeDeadlineSeconds: 900,
          backoffLimit: 1,
          template: {
            spec: {
              restartPolicy: "Never",
              nodeSelector: { "kubernetes.io/hostname": CI_NODE_HOSTNAME },
              tolerations: [CI_NODE_TOLERATION],
              containers: [
                {
                  name: "bun-cache-gc",
                  image: `ghcr.io/shepherdjerred/ci-base@${CI_BASE_DIGEST}`,
                  imagePullPolicy: "IfNotPresent",
                  command: ["bash", "/buildkite/maintenance/bun-cache-gc.sh"],
                  env: [
                    {
                      name: "BUN_INSTALL_CACHE_DIR",
                      value: BUN_CACHE_DATA_PATH,
                    },
                    {
                      name: "BUN_CACHE_LOCK_FILE",
                      value: BUN_CACHE_LOCK_PATH,
                    },
                    {
                      name: "BUN_CACHE_GC_THRESHOLD_PERCENT",
                      value: BUN_CACHE_GC_THRESHOLD_PERCENT,
                    },
                  ],
                  resources: {
                    requests: {
                      cpu: Quantity.fromString("50m"),
                      memory: Quantity.fromString("128Mi"),
                    },
                    limits: {
                      cpu: Quantity.fromString("500m"),
                      memory: Quantity.fromString("512Mi"),
                    },
                  },
                  volumeMounts: [
                    {
                      name: "bun-cache",
                      mountPath: BUN_CACHE_MOUNT_PATH,
                    },
                    {
                      name: "bun-cache-control",
                      mountPath: BUN_CACHE_CONTROL_PATH,
                    },
                    {
                      name: "bun-cache-gc-script",
                      mountPath: "/buildkite/maintenance",
                      readOnly: true,
                    },
                  ],
                },
              ],
              volumes: [
                {
                  name: "bun-cache",
                  persistentVolumeClaim: { claimName: "buildkite-bun-cache" },
                },
                {
                  name: "bun-cache-control",
                  persistentVolumeClaim: {
                    claimName: "buildkite-bun-cache-control",
                  },
                },
                {
                  name: "bun-cache-gc-script",
                  configMap: {
                    name: "buildkite-bun-cache-gc",
                    defaultMode: 365,
                  },
                },
              ],
            },
          },
        },
      },
    },
  });
}
