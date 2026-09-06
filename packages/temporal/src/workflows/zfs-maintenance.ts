import { log, proxyActivities } from "@temporalio/workflow";
import type { ZfsMaintenanceActivities } from "#activities/homelab/zfs-maintenance.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { runZfsMaintenance } = proxyActivities<ZfsMaintenanceActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  // Four `kubectl exec` calls (autotrim×2, scrub-status×2 / scrub-init×2);
  // each completes in seconds. Heartbeats fire between each — see
  // zfs-maintenance.ts.
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "90 seconds",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30s",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

export async function runZfsMaintenanceWorkflow(): Promise<void> {
  const result = await runZfsMaintenance();
  log.info("ZFS maintenance complete", { result });
}
