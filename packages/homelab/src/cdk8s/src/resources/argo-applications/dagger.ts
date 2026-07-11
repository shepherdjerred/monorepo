import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import {
  IntOrString,
  KubeJob,
  KubeRole,
  KubeRoleBinding,
  KubeService,
  KubeServiceAccount,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { BUILDCACHE_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

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
        "argocd.argoproj.io/hook": "Sync",
        "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation",
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

  // RBAC for the docker-config-builder Job to create secrets in the dagger namespace.
  new KubeServiceAccount(chart, "docker-config-builder-sa", {
    metadata: { name: "docker-config-builder", namespace: "dagger" },
  });

  new KubeRole(chart, "docker-config-builder-role", {
    metadata: { name: "docker-config-builder", namespace: "dagger" },
    rules: [
      {
        apiGroups: [""],
        resources: ["secrets"],
        verbs: ["get", "create", "update", "patch"],
      },
    ],
  });

  new KubeRoleBinding(chart, "docker-config-builder-rb", {
    metadata: { name: "docker-config-builder", namespace: "dagger" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "docker-config-builder",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "docker-config-builder",
        namespace: "dagger",
      },
    ],
  });

  // One-shot Job: reads username+credential from 1Password-synced secret,
  // constructs a Docker config.json, and writes it to a new secret that
  // the Dagger engine mounts for authenticated Docker Hub pulls.
  new KubeJob(chart, "docker-config-builder", {
    metadata: {
      name: "docker-config-builder",
      namespace: "dagger",
      annotations: {
        "argocd.argoproj.io/hook": "Sync",
        "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation",
        "ignore-check.kube-linter.io/run-as-non-root":
          "Minimal alpine container, no privilege needed beyond K8s API access",
      },
    },
    spec: {
      backoffLimit: 3,
      ttlSecondsAfterFinished: 86_400,
      template: {
        spec: {
          serviceAccountName: "docker-config-builder",
          restartPolicy: "OnFailure",
          containers: [
            {
              name: "builder",
              image: `docker.io/alpine:${versions["library/alpine"]}`,
              command: ["/bin/sh", "-c"],
              args: [
                String.raw`set -e
apk add --no-cache curl
USER=$(cat /secret/username)
CRED=$(cat /secret/credential)
AUTH=$(echo -n "$USER:$CRED" | base64)
CONFIG=$(printf '{"auths":{"https://index.docker.io/v1/":{"auth":"%s"}}}' "$AUTH")
CONFIG_B64=$(echo -n "$CONFIG" | base64 | tr -d '\n')

TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
CA=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
API=https://kubernetes.default.svc/api/v1/namespaces/dagger/secrets

# Try to create; if it exists, patch it
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$API/docker-hub-config")
if [ "$STATUS" = "200" ]; then
  echo "Secret exists, patching..."
  curl -sf --cacert "$CA" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/strategic-merge-patch+json" \
    -X PATCH "$API/docker-hub-config" \
    -d "{\"data\":{\"config.json\":\"$CONFIG_B64\"}}"
else
  echo "Creating secret..."
  curl -sf --cacert "$CA" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -X POST "$API" \
    -d "{\"apiVersion\":\"v1\",\"kind\":\"Secret\",\"metadata\":{\"name\":\"docker-hub-config\",\"namespace\":\"dagger\"},\"data\":{\"config.json\":\"$CONFIG_B64\"}}"
fi
echo "Done."`,
              ],
              resources: {
                requests: {
                  cpu: Quantity.fromString("50m"),
                  memory: Quantity.fromString("32Mi"),
                },
              },
              volumeMounts: [
                {
                  name: "docker-hub-secret",
                  mountPath: "/secret",
                  readOnly: true,
                },
              ],
            },
          ],
          volumes: [
            {
              name: "docker-hub-secret",
              secret: { secretName: "docker-hub-credentials" },
            },
          ],
        },
      },
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
              // 2026-07 CI-freeze hardening: a CPU limit was added after concurrent CI
              // session bursts on the previously-unbounded engine drove host load1 into
              // the thousands-to-tens-of-thousands and hard-locked the node's kernel
              // scheduler 7 times in 3 days (2026-07-05/07). 16 is ~3.5x the 30d observed
              // peak of 4.6 CPU — enough headroom for legitimate heavy concurrent bursts,
              // while bounding the worst-case runqueue pressure this one container can
              // cause to a finite slice of the node's 32 threads instead of unbounded.
              // See packages/docs/logs/2026-07-08_torvalds-cluster-health-deep-check.md
              // and packages/docs/logs/2026-07-05_torvalds-ci-freeze-investigation.md.
              //
              // Memory right-sized 2026-07-10 (req 16Gi -> 8Gi, lim 50Gi -> 24Gi) from
              // 30d working-set data: p50 2.6Gi, p95 6.7Gi, max 15.6Gi. The request
              // sits just above p95 (scheduling guarantee); the limit is ~1.5x the 30d
              // max. On a single-node cluster an oversized request buys nothing except
              // blocking other pods from scheduling — it was the largest single line
              // item (26% of allocatable) when CI pods went unschedulable at 99.99%
              // requested. See packages/docs/plans/2026-07-10_torvalds-memory-rightsize.md.
              resources: {
                requests: {
                  cpu: "6",
                  memory: "8Gi",
                },
                limits: {
                  cpu: "16",
                  memory: "24Gi",
                },
              },
              // After an unclean shutdown the engine wipes and rebuilds its dagql/
              // BuildKit cache state over the 2Ti build-cache PVC; during that cold
              // start `dagger core version` (the probe command) times out for well
              // over the chart-default 10 minutes (period 30s x failureThreshold 20),
              // especially with CI jobs hammering the engine. The liveness kill then
              // causes the NEXT unclean shutdown, looping forever — observed live
              // 2026-07-10 (22 restarts in 22h on the old pod, then a fresh pod
              // killed at 11m mid-cold-start). 2026-07-11 storm: a 10-minute node
              // load spike (load1 13,552) tripped this same loop 4 more times
              // (restarts 30 min apart, 19:32/20:02/20:34/21:04Z) and wiped the
              // buildcache PVC from 1.2Ti down to 16Gi before recovering — see
              // packages/docs/logs/2026-07-11_afternoon-dagger-restart-loop.md.
              //
              // Root cause of *why* the wipe was unavoidable: `failureThreshold: 60`
              // only widens how long the engine can fail probes before being killed —
              // it does nothing about what happens at the moment of the kill. The
              // chart defaults the liveness probe's own `terminationGracePeriodSeconds`
              // (a distinct, probe-scoped override of the pod-level grace period,
              // introduced in k8s 1.25 — see `terminationGracePeriodSeconds` below,
              // which only governs pod deletion, NOT probe-triggered kills) to just
              // 30s. That's nowhere near enough time to flush dagql/BuildKit state
              // under load, so a liveness-triggered restart was *guaranteed* to be
              // unclean and trigger the wipe, no matter how generous failureThreshold
              // was. Raised to 280s (just under the pod-level 300s grace) so the
              // engine gets a real chance at a clean shutdown when liveness fires,
              // which should make the wipe-and-loop path the exception rather than
              // the rule. failureThreshold also raised 60 -> 240 (2h) as defense in
              // depth: the 2026-07-11 storm needed up to ~90 min of cold-start-after-
              // wipe before probes passed again, which 30 min does not cover.
              // Readiness settings stay at chart defaults — failing readiness only
              // gates traffic, which is correct during cold start.
              livenessProbeSettings: {
                failureThreshold: 240,
                terminationGracePeriodSeconds: 280,
              },
              // Garbage collection policy. IMPORTANT: maxUsedSpace bounds only the
              // *reclaimable* BuildKit cache, NOT total dataset usage — metadata DBs
              // (containerdmeta.db / metadata_v2.db), active leases, and in-flight exec
              // mounts are uncounted. On 2026-06-08 the engine EDQUOT'd at the (then) 1 Ti
              // ZFS quota mid-build (main CI build 3668) even though the cap was 600 GB.
              // Live metrics post-expansion: 2 Ti capacity, ~1.06 Ti used — i.e. ~560 GB
              // sits ABOVE the cache cap, so this number is NOT a reliable disk-usage
              // ceiling. Keep absolute byte values (a `%`/default policy reads pool-level
              // free space on this quota'd ZFS dataset and is unsafe). Raised 600 -> 800 GB
              // (restoring the pre-2026-02 value; the emergency reduction to 600 was for a
              // disk-I/O incident whose drivers — concurrency, compression — are now
              // mitigated). Conservative on purpose given the large over-cap footprint;
              // the DaggerEnginePVCStorage* alerts now provide steady-state visibility to
              // tune further. See packages/docs/guides/2026-06-07_dagger-engine-pvc-resize.md.
              //
              // 2026-07-03 outage postscript: this config was live and working (steady
              // state sat flat at ~1.33 Ti / 60% for days), but a Renovate rebase-wave
              // build storm wrote ~670 GB in 100 minutes and outran the reactive,
              // rate-limited GC to a 100%-full deadlock. No GC setting prevents that —
              // headroom, input smoothing (renovate.json prConcurrentLimit), and the
              // DaggerEnginePVCFillPredicted alert do. minFreeSpace was also switched
              // 20% -> 400GB absolute here: the `%` form contradicted the "keep absolute
              // byte values" rule above. NOTE: the engine reads this file only at
              // startup — a config change needs `kubectl rollout restart` (see runbook).
              // Post-mortem: packages/docs/logs/2026-07-03_dagger-engine-disk-full-outage.md
              configJson: JSON.stringify({
                gc: {
                  maxUsedSpace: "800GB",
                  reservedSpace: "200GB",
                  minFreeSpace: "400GB",
                },
              }),
              volumes: [
                {
                  name: "docker-config",
                  secret: {
                    secretName: "docker-hub-config",
                    items: [{ key: "config.json", path: "config.json" }],
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
              statefulSet: {
                persistentVolumeClaim: {
                  enabled: true,
                  storageClassName: BUILDCACHE_STORAGE_CLASS,
                  accessModes: ["ReadWriteOnce"],
                  resources: {
                    requests: {
                      // 2 TiB cache. Engine PVC was hitting 72% on 1 TiB,
                      // triggering BuildKit GC churn (re-uploading evicted blobs).
                      // See dagger/dagger#7711, #10504. Storage class allows online
                      // expansion, BUT changing this value alone does NOT resize the
                      // live PVC — STS volumeClaimTemplates are immutable, so a manual
                      // `kubectl patch pvc` is required (this drift caused the 2026-06-08
                      // outage). Runbook + exact command:
                      // packages/docs/guides/2026-06-07_dagger-engine-pvc-resize.md
                      storage: "2Ti",
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
          } satisfies HelmValuesForChart<"dagger-helm">,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "dagger",
      },
      syncPolicy: {
        automated: {},
        syncOptions: [
          "CreateNamespace=true",
          "ServerSideApply=true",
          "RespectIgnoreDifferences=true",
          "ApplyOutOfSyncOnly=true",
        ],
      },
      // Kubernetes injects fields (apiVersion, kind, volumeMode, status) into
      // volumeClaimTemplates that aren't in the desired manifest, causing
      // permanent OutOfSync. Ignore the entire VCT to suppress phantom drift.
      ignoreDifferences: [
        {
          group: "apps",
          kind: "StatefulSet",
          jqPathExpressions: [".spec.volumeClaimTemplates[]"],
        },
      ],
    },
  });
}
