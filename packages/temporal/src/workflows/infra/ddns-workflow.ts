import { proxyActivities } from "@temporalio/workflow";
import type { DdnsActivities, DdnsSyncResult } from "#activities/infra/ddns.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { syncDdnsRecords } = proxyActivities<DdnsActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "4 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
  },
});

export async function runDdnsSyncWorkflow(): Promise<DdnsSyncResult> {
  return syncDdnsRecords();
}
