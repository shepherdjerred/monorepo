import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import { Cpu, Job, ServiceAccount } from "cdk8s-plus-31";
import {
  KubeClusterRole,
  KubeClusterRoleBinding,
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const BACKUP_SCHEDULE_NAME = "6hourly-backup";
const MAXIMUM_BACKUP_AGE_SECONDS = 7 * 60 * 60;
const TEMPORAL_POSTGRES_PVC_NAMESPACE = "temporal";
const TEMPORAL_POSTGRES_PVC_NAME = "pgdata-temporal-postgresql-0";
const BACKUP_ENABLED_LABEL = "velero.io/backup";

const BACKUP_PREFLIGHT_SCRIPT = String.raw`
set -eu -o pipefail

backup_name=$(kubectl get backups.velero.io \
  --namespace velero \
  --selector velero.io/schedule-name=${BACKUP_SCHEDULE_NAME} \
  --sort-by=.status.completionTimestamp \
  --output jsonpath='{.items[-1:].metadata.name}')

if [ -z "$backup_name" ]; then
  echo "No completed candidate exists for ${BACKUP_SCHEDULE_NAME}" >&2
  exit 1
fi

phase=$(kubectl get backup.velero.io "$backup_name" --namespace velero --output jsonpath='{.status.phase}')
completed_at=$(kubectl get backup.velero.io "$backup_name" --namespace velero --output jsonpath='{.status.completionTimestamp}')
errors=$(kubectl get backup.velero.io "$backup_name" --namespace velero --output jsonpath='{.status.errors}')
# Velero's status.errors is omitempty, so a backup with NO errors omits the
# field entirely and jsonpath yields "". Absent means zero here; without this
# the numeric guard below reads ":48:48" and rejects precisely the clean
# backups this hook exists to accept. Spelled without braces because this
# script is a template literal: String.raw suppresses escapes, not \${}.
if [ -z "$errors" ]; then
  errors=0
fi
snapshots_attempted=$(kubectl get backup.velero.io "$backup_name" --namespace velero --output jsonpath='{.status.volumeSnapshotsAttempted}')
snapshots_completed=$(kubectl get backup.velero.io "$backup_name" --namespace velero --output jsonpath='{.status.volumeSnapshotsCompleted}')
selector=$(kubectl get backup.velero.io "$backup_name" --namespace velero --output jsonpath='{.spec.labelSelector.matchLabels.velero\.io/backup}')

if [ "$phase" != "Completed" ]; then
  echo "Backup $backup_name is not completed" >&2
  exit 1
fi

if [ "$selector" != "enabled" ]; then
  echo "Backup $backup_name does not select backup-enabled resources" >&2
  exit 1
fi

case "$errors:$snapshots_attempted:$snapshots_completed" in
  *[!0-9:]*|::*|*::|:*)
    echo "Backup $backup_name has incomplete numeric status" >&2
    exit 1
    ;;
esac

if [ "$errors" -ne 0 ]; then
  echo "Backup $backup_name contains errors" >&2
  exit 1
fi

if [ "$snapshots_attempted" -le 0 ] || [ "$snapshots_completed" -ne "$snapshots_attempted" ]; then
  echo "Backup $backup_name did not complete every volume snapshot" >&2
  exit 1
fi

# The aggregate counters above are cluster-wide: they can be positive and
# equal purely because OTHER backup-enabled PVCs succeeded, even if this
# specific Temporal PVC was never selected or its snapshot silently failed to
# attempt. The openebs zfs-localpv plugin (per-PVC "zfs send", not Velero's
# CSI DataUpload machinery) records no separate per-PVC status object we can
# query, so instead prove the Temporal PVC's snapshot specifically by
# cross-referencing against the live PVC inventory: first confirm it still
# carries the label the backup selected on, then confirm the counters equal
# the CURRENT count of backup-enabled PVCs cluster-wide. If every
# backup-enabled PVC that exists right now was attempted and completed, the
# Temporal PVC — already confirmed to be one of them — cannot have been
# omitted or have failed silently.
temporal_pvc_label=$(kubectl get persistentvolumeclaim ${TEMPORAL_POSTGRES_PVC_NAME} \
  --namespace ${TEMPORAL_POSTGRES_PVC_NAMESPACE} \
  --output jsonpath='{.metadata.labels.velero\.io/backup}')

if [ "$temporal_pvc_label" != "enabled" ]; then
  echo "${TEMPORAL_POSTGRES_PVC_NAME} in namespace ${TEMPORAL_POSTGRES_PVC_NAMESPACE} is not labeled ${BACKUP_ENABLED_LABEL}=enabled" >&2
  exit 1
fi

enabled_pvc_count=$(kubectl get persistentvolumeclaims \
  --all-namespaces \
  --selector ${BACKUP_ENABLED_LABEL}=enabled \
  --output jsonpath='{.items[*].metadata.name}' | wc -w | tr -d ' ')

if [ "$enabled_pvc_count" -le 0 ] || [ "$snapshots_attempted" -ne "$enabled_pvc_count" ]; then
  echo "Backup $backup_name attempted $snapshots_attempted snapshot(s) but $enabled_pvc_count PVC(s) are currently backup-enabled — cannot prove ${TEMPORAL_POSTGRES_PVC_NAME} was included" >&2
  exit 1
fi

completed_epoch=$(date -d "$completed_at" +%s)
current_epoch=$(date +%s)
age_seconds=$((current_epoch - completed_epoch))

if [ "$age_seconds" -lt 0 ] || [ "$age_seconds" -gt ${MAXIMUM_BACKUP_AGE_SECONDS} ]; then
  echo "Backup $backup_name is outside the seven-hour release window" >&2
  exit 1
fi

echo "Backup $backup_name satisfies the Temporal server upgrade preflight"
`.trim();

// PreSync hooks run in their own hook phase, strictly before ANY ordinary
// (non-hook) resource is applied — sync-wave only orders resources within the
// same phase. Without a hook annotation of their own, this RBAC would be a
// plain Sync-phase resource that ArgoCD only applies AFTER the PreSync Job
// below has already tried (and failed, on a first sync) to run as that
// ServiceAccount. -3 puts it a full wave ahead of the Job's own -2.
const RBAC_HOOK_ANNOTATIONS = {
  "argocd.argoproj.io/hook": "PreSync",
  "argocd.argoproj.io/sync-wave": "-3",
};

export function createTemporalBackupPreflightJob(chart: Chart) {
  const serviceAccount = new ServiceAccount(
    chart,
    "temporal-backup-preflight-service-account",
    {
      metadata: {
        name: "temporal-backup-preflight",
        annotations: RBAC_HOOK_ANNOTATIONS,
      },
    },
  );

  new KubeRole(chart, "temporal-backup-preflight-role", {
    metadata: {
      name: "temporal-backup-preflight",
      namespace: "velero",
      annotations: RBAC_HOOK_ANNOTATIONS,
    },
    rules: [
      {
        apiGroups: ["velero.io"],
        resources: ["backups"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeRoleBinding(chart, "temporal-backup-preflight-role-binding", {
    metadata: {
      name: "temporal-backup-preflight",
      namespace: "velero",
      annotations: RBAC_HOOK_ANNOTATIONS,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "temporal-backup-preflight",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace: "temporal",
      },
    ],
  });

  // Cluster-wide, read-only: proving the Temporal PVC's snapshot specifically
  // succeeded (see BACKUP_PREFLIGHT_SCRIPT) needs the current count of every
  // backup-enabled PVC across every namespace, not only the temporal
  // namespace's own PVC.
  new KubeClusterRole(chart, "temporal-backup-preflight-pvc-reader", {
    metadata: {
      name: "temporal-backup-preflight-pvc-reader",
      annotations: RBAC_HOOK_ANNOTATIONS,
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["persistentvolumeclaims"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeClusterRoleBinding(
    chart,
    "temporal-backup-preflight-pvc-reader-binding",
    {
      metadata: {
        name: "temporal-backup-preflight-pvc-reader",
        annotations: RBAC_HOOK_ANNOTATIONS,
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: "temporal-backup-preflight-pvc-reader",
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: serviceAccount.name,
          namespace: "temporal",
        },
      ],
    },
  );

  const job = new Job(chart, "temporal-backup-preflight", {
    metadata: {
      name: "temporal-backup-preflight",
      annotations: {
        "argocd.argoproj.io/hook": "PreSync",
        "argocd.argoproj.io/sync-wave": "-2",
        "argocd.argoproj.io/hook-delete-policy":
          "BeforeHookCreation,HookSucceeded",
      },
    },
    serviceAccount,
    // The whole script is `kubectl`, and the ServiceAccount above carries the
    // Role/ClusterRole it needs. cdk8s-plus defaults this to false, so without
    // it no token is projected: kubectl finds no in-cluster config, falls back
    // to localhost:8080, and the hook fails the entire temporal sync.
    automountServiceAccountToken: true,
    backoffLimit: 1,
    activeDeadline: Duration.minutes(2),
    podMetadata: { labels: { app: "temporal-backup-preflight" } },
  });

  job.addContainer(
    withCommonProps({
      name: "backup-preflight",
      image: `bitnamilegacy/kubectl:${versions["bitnamilegacy/kubectl"]}`,
      command: ["/bin/bash", "-c"],
      args: [BACKUP_PREFLIGHT_SCRIPT],
      securityContext: {
        user: 1001,
        group: 1001,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
      },
      resources: {
        cpu: { request: Cpu.millis(10), limit: Cpu.millis(100) },
        memory: { request: Size.mebibytes(32), limit: Size.mebibytes(128) },
      },
    }),
  );

  return job;
}
