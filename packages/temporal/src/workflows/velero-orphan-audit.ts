import { log, proxyActivities } from "@temporalio/workflow";
import type { VeleroOrphanAuditActivities } from "#activities/homelab/velero-orphan-audit.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { runVeleroOrphanAudit } = proxyActivities<VeleroOrphanAuditActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  // The activity performs one zfs inventory command per Ready OpenEBS node.
  // Heartbeats fire per node so a worker death surfaces promptly.
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "90 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30s",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

export async function runVeleroOrphanAuditWorkflow(): Promise<void> {
  const result = await runVeleroOrphanAudit();

  // Log a structured summary for Loki / Bugsink ingestion. The Prometheus
  // gauges are emitted directly by the activity via the prom-client registry
  // (see src/observability/metrics.ts).
  log.info("Velero orphan audit complete", {
    liveBackupCount: result.liveBackupCount,
    totalSnapshotCount: result.totalSnapshotCount,
    totalOrphanCount: result.totalOrphanCount,
    totalOrphanBytes: result.totalOrphanBytes,
    orphanDatasetCount: result.datasets.filter(
      (dataset) => dataset.orphanCount > 0,
    ).length,
    durationSeconds: result.workflowDurationSeconds,
  });

  if (result.totalOrphanCount > 0) {
    log.warn(
      `Velero orphan audit: ${String(result.totalOrphanCount)} orphan snapshots ` +
        `(${String(Math.round(result.totalOrphanBytes / 1024 / 1024))} MiB) across ` +
        `${String(result.datasets.filter((d) => d.orphanCount > 0).length)} datasets. ` +
        `Run remediation runbook: packages/temporal/runbooks/velero-orphan-snapshot-remediation.md`,
    );
  }
}
