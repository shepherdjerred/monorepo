import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import {
  KubeJob,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { BUILDCACHE_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";

// ZFS properties that OpenEBS CSI doesn't support as storage class parameters.
// Applied via a one-shot Job that runs `zfs set` on the Dagger engine's dataset.
const ZFS_TUNING_PROPERTIES = "sync=disabled logbias=throughput atime=off";

export function createDaggerApp(chart: Chart) {
  new Namespace(chart, "dagger-namespace", {
    metadata: {
      name: "dagger",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "privileged",
        "pod-security.kubernetes.io/warn": "privileged",
      },
    },
  });

  // One-shot Job to apply ZFS properties not supported by OpenEBS CSI storage class params.
  // Finds the Dagger PVC's backing ZFS dataset and sets sync/logbias/atime.
  // Idempotent: re-running `zfs set` with the same values is a no-op.
  new KubeJob(chart, "dagger-zfs-tuning", {
    metadata: {
      name: "dagger-zfs-tuning",
      namespace: "dagger",
      annotations: {
        "ignore-check.kube-linter.io/privileged-container":
          "Required for ZFS device access",
        "ignore-check.kube-linter.io/privilege-escalation-container":
          "Required when privileged is true",
        "ignore-check.kube-linter.io/run-as-non-root":
          "Required for ZFS access as root",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Required to install zfs tools at runtime",
      },
    },
    spec: {
      backoffLimit: 3,
      ttlSecondsAfterFinished: 86_400,
      template: {
        spec: {
          restartPolicy: "OnFailure",
          containers: [
            {
              name: "zfs-tuning",
              image: `docker.io/alpine:${versions["library/alpine"]}`,
              command: ["/bin/sh", "-c"],
              args: [
                `set -e
apk add --no-cache zfs
# Find datasets on zfs-ssd-buildcache (identified by compression=lz4, unique to this storage class)
DATASET=$(zfs list -H -o name,compression | awk '$2 == "lz4" {print $1}' | grep 'zfspv-pool-nvme/pvc-' | head -1)
if [ -z "$DATASET" ]; then
  echo "ERROR: No ZFS dataset found with compression=lz4 on zfspv-pool-nvme"
  exit 1
fi
echo "Applying ZFS tuning to $DATASET"
zfs set ${ZFS_TUNING_PROPERTIES} "$DATASET"
echo "Done. Current properties:"
zfs get sync,logbias,atime "$DATASET"`,
              ],
              securityContext: {
                privileged: true,
                allowPrivilegeEscalation: true,
                runAsUser: 0,
                runAsGroup: 0,
                runAsNonRoot: false,
                readOnlyRootFilesystem: false,
              },
              resources: {
                requests: {
                  cpu: Quantity.fromString("100m"),
                  memory: Quantity.fromString("128Mi"),
                },
              },
              volumeMounts: [
                { name: "host-dev", mountPath: "/dev" },
              ],
            },
          ],
          volumes: [
            {
              name: "host-dev",
              hostPath: { path: "/dev" },
            },
          ],
        },
      },
    },
  });

  return new Application(chart, "dagger-app", {
    metadata: {
      name: "dagger",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "registry.dagger.io",
        chart: "dagger-helm",
        targetRevision: versions["dagger-helm"],
        helm: {
          valuesObject: {
            engine: {
              kind: "StatefulSet",
              configJson: JSON.stringify({
                gc: {
                  maxUsedSpace: "600GB",
                  reservedSpace: "100GB",
                  minFreeSpace: "20%",
                },
              }),
              statefulSet: {
                persistentVolumeClaim: {
                  enabled: true,
                  storageClassName: BUILDCACHE_STORAGE_CLASS,
                  accessModes: ["ReadWriteOnce"],
                  resources: {
                    requests: {
                      storage: "1Ti",
                    },
                  },
                },
              },
              hostPath: {
                dataVolume: {
                  enabled: false,
                },
              },
            },
          },
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "dagger",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
