import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import {
  IntOrString,
  KubeJob,
  KubeService,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { BUILDCACHE_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

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
              volumeMounts: [{ name: "host-dev", mountPath: "/dev" }],
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

  // Docker Hub credentials for authenticated pulls (avoids rate limits).
  // 1Password Connect syncs the item into a K8s Secret with `username` and `credential` keys.
  new OnePasswordItem(chart, "docker-hub-credentials", {
    spec: {
      itemPath: vaultItemPath("47tnfq54mh2za3lhiqw2d4ffx4"),
    },
    metadata: {
      name: "docker-hub-credentials",
      namespace: "dagger",
    },
  });

  // ClusterIP Service so CI pods can reach the engine via TCP.
  // The Helm chart does not create a Service; we manage one ourselves.
  new KubeService(chart, "dagger-engine-service", {
    metadata: {
      name: "dagger-engine",
      namespace: "dagger",
      annotations: {
        "ignore-check.kube-linter.io/dangling-service":
          "Pods are managed by Dagger Helm chart",
      },
    },
    spec: {
      type: "ClusterIP",
      selector: {
        name: "dagger-dagger-helm-engine",
      },
      ports: [
        {
          name: "dagger",
          port: 8080,
          targetPort: IntOrString.fromNumber(8080),
          protocol: "TCP",
        },
      ],
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
              port: 8080,
              resources: {
                requests: {
                  cpu: "2",
                  memory: "4Gi",
                },
                limits: {
                  memory: "8Gi",
                },
              },
              configJson: JSON.stringify({
                gc: {
                  maxUsedSpace: "600GB",
                  reservedSpace: "100GB",
                  minFreeSpace: "20%",
                },
              }),
              volumes: [
                {
                  name: "docker-config",
                  emptyDir: {},
                },
                {
                  name: "docker-hub-secret",
                  secret: {
                    secretName: "docker-hub-credentials",
                  },
                },
              ],
              volumeMounts: [
                {
                  name: "docker-config",
                  mountPath: "/root/.docker",
                  readOnly: true,
                },
              ],
              initContainers: [
                {
                  name: "docker-config-init",
                  image: `docker.io/alpine:${versions["library/alpine"]}`,
                  command: ["/bin/sh", "-c"],
                  args: [
                    `USER=$(cat /secret/username) && CRED=$(cat /secret/credential) && AUTH=$(echo -n "$USER:$CRED" | base64) && printf '{"auths":{"https://index.docker.io/v1/":{"auth":"%s"}}}' "$AUTH" > /docker-config/config.json`,
                  ],
                  volumeMounts: [
                    { name: "docker-hub-secret", mountPath: "/secret", readOnly: true },
                    { name: "docker-config", mountPath: "/docker-config" },
                  ],
                },
              ],
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
