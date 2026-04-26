import { proxyActivities } from "@temporalio/workflow";
import type { ZfsMaintenanceActivities } from "#activities/zfs-maintenance.ts";

const { runZfsMaintenance } = proxyActivities<ZfsMaintenanceActivities>({
  startToCloseTimeout: "10 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30s",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

export async function runZfsMaintenanceWorkflow(): Promise<void> {
  const result = await runZfsMaintenance();
  console.warn("ZFS maintenance complete:\n", result);
}
