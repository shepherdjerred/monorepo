import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import { Cpu, Job, ServiceAccount } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const BACKUP_SCHEDULE_NAME = "6hourly-backup";
const MAXIMUM_BACKUP_AGE_SECONDS = 7 * 60 * 60;

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

completed_epoch=$(date -d "$completed_at" +%s)
current_epoch=$(date +%s)
age_seconds=$((current_epoch - completed_epoch))

if [ "$age_seconds" -lt 0 ] || [ "$age_seconds" -gt ${MAXIMUM_BACKUP_AGE_SECONDS} ]; then
  echo "Backup $backup_name is outside the seven-hour release window" >&2
  exit 1
fi

echo "Backup $backup_name satisfies the Temporal server upgrade preflight"
`.trim();

export function createTemporalBackupPreflightJob(chart: Chart) {
  const serviceAccount = new ServiceAccount(
    chart,
    "temporal-backup-preflight-service-account",
    { metadata: { name: "temporal-backup-preflight" } },
  );

  new KubeRole(chart, "temporal-backup-preflight-role", {
    metadata: { name: "temporal-backup-preflight", namespace: "velero" },
    rules: [
      {
        apiGroups: ["velero.io"],
        resources: ["backups"],
        verbs: ["get", "list"],
      },
    ],
  });

  new KubeRoleBinding(chart, "temporal-backup-preflight-role-binding", {
    metadata: { name: "temporal-backup-preflight", namespace: "velero" },
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
