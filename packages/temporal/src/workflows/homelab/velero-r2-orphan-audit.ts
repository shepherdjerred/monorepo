import { log, proxyActivities } from "@temporalio/workflow";
import type { VeleroR2OrphanAuditActivities } from "#activities/homelab/velero-r2-orphan-audit.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { runVeleroR2OrphanAudit } =
  proxyActivities<VeleroR2OrphanAuditActivities>({
    taskQueue: TASK_QUEUES.INFRA,
    // The activity lists two R2 prefixes (~3k objects) plus the live Backup
    // CRs. Heartbeats fire per listing page so a worker death surfaces
    // promptly.
    startToCloseTimeout: "10 minutes",
    heartbeatTimeout: "90 seconds",
    retry: {
      maximumAttempts: 3,
      initialInterval: "30s",
      backoffCoefficient: 2,
      maximumInterval: "2 minutes",
    },
  });

export async function runVeleroR2OrphanAuditWorkflow(): Promise<void> {
  const result = await runVeleroR2OrphanAudit();

  // Log a structured summary for Loki / Bugsink ingestion. The Prometheus
  // gauges are emitted directly by the activity via the prom-client registry
  // (see src/observability/metrics.ts).
  log.info("Velero R2 orphan audit complete", {
    liveBackupCount: result.liveBackupCount,
    zfsPrefixCount: result.zfsPrefixCount,
    orphanPrefixCount: result.orphanPrefixCount,
    orphanBytes: result.orphanBytes,
    durationSeconds: result.workflowDurationSeconds,
  });

  if (result.orphanPrefixCount > 0) {
    log.warn(
      `Velero R2 orphan audit: ${String(result.orphanPrefixCount)} orphan prefixes ` +
        `(${String(Math.round(result.orphanBytes / 1024 / 1024 / 1024))} GiB). ` +
        `Run remediation runbook: packages/temporal/runbooks/r2-capacity-remediation.md`,
    );
  }
}
