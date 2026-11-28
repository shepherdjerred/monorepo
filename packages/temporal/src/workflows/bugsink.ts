import { log, patched, proxyActivities } from "@temporalio/workflow";
import type { BugsinkHousekeepingActivities } from "#activities/bugsink.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export const RETIRE_BUGSINK_HOUSEKEEPING_PATCH =
  "retire-bugsink-housekeeping-v1";

const { runBugsinkHousekeeping } =
  proxyActivities<BugsinkHousekeepingActivities>({
    taskQueue: TASK_QUEUES.INFRA,
    startToCloseTimeout: "5 minutes",
    heartbeatTimeout: "90 seconds",
    retry: {
      maximumAttempts: 3,
      initialInterval: "30s",
      backoffCoefficient: 2,
      maximumInterval: "5 minutes",
    },
  });

export async function runBugsinkHousekeepingWorkflow(): Promise<void> {
  if (patched(RETIRE_BUGSINK_HOUSEKEEPING_PATCH)) {
    log.info("Bugsink housekeeping retired in favor of @shepherdjerred/errors");
    return;
  }
  const result = await runBugsinkHousekeeping();
  log.info("Bugsink housekeeping complete", { result });
}
