import { log, proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { StormPlotActivities } from "#activities/homelab/storm-plots.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { reconcileStormPlots } = proxyActivities<StormPlotActivities>({
  taskQueue: TASK_QUEUES.MINING_RESET,
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "45 seconds",
  retry: { maximumAttempts: 2, initialInterval: "30 seconds" },
});

export async function runStormPlotReconciliationWorkflow(): Promise<void> {
  const result = await reconcileStormPlots(workflowInfo().runId);
  log.info("The Storm plot reconciliation", { result });
}
