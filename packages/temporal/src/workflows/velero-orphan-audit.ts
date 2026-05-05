import { proxyActivities } from "@temporalio/workflow";
import type { VeleroOrphanAuditActivities } from "#activities/velero-orphan-audit.ts";

const { runVeleroOrphanAudit } = proxyActivities<VeleroOrphanAuditActivities>({
  // Listing ZFS snapshots cluster-wide is bounded by:
  //   ~90 datasets × 2 zfs list calls × ~0.5s each ≈ 90s under typical load.
  // Heartbeats fire per-pool and per-dataset so a worker death surfaces in <90s.
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
  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Velero orphan audit complete",
      component: "temporal-worker",
      module: "velero-orphan-audit",
      liveBackupCount: result.liveBackupCount,
      totalSnapshotCount: result.totalSnapshotCount,
      totalOrphanCount: result.totalOrphanCount,
      totalOrphanBytes: result.totalOrphanBytes,
      orphansByDataset: result.datasets
        .filter((d) => d.orphanCount > 0)
        .map((d) => ({
          dataset: d.dataset,
          orphanCount: d.orphanCount,
          orphanBytes: d.orphanBytes,
        })),
      durationSeconds: result.workflowDurationSeconds,
    }),
  );

  if (result.totalOrphanCount > 0) {
    console.warn(
      `Velero orphan audit: ${String(result.totalOrphanCount)} orphan snapshots ` +
        `(${String(Math.round(result.totalOrphanBytes / 1024 / 1024))} MiB) across ` +
        `${String(result.datasets.filter((d) => d.orphanCount > 0).length)} datasets. ` +
        `Run remediation runbook: packages/docs/guides/2026-05-05_velero-orphan-snapshot-remediation.md`,
    );
  }
}
