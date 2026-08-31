import { log, proxyActivities } from "@temporalio/workflow";
import type { BugsinkHousekeepingActivities } from "#activities/bugsink.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { runBugsinkHousekeeping } =
  proxyActivities<BugsinkHousekeepingActivities>({
    taskQueue: TASK_QUEUES.INFRA,
    // Each `bugsink-manage` subcommand finishes in seconds; 5 of them in
    // sequence comfortably fits in 5 min. Activity heartbeats every 30s
    // (see bugsink.ts) so a worker death surfaces in <90s instead of
    // burning the whole startToCloseTimeout.
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
  const result = await runBugsinkHousekeeping();
  log.info("Bugsink housekeeping complete", { result });
}
