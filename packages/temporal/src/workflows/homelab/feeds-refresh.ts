import { proxyActivities } from "@temporalio/workflow";
import type {
  FeedsMaintenanceActivities,
  FeedsRefreshSummary,
} from "#activities/maintenance/feeds/feeds.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { triggerFeedsRefresh } = proxyActivities<FeedsMaintenanceActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "4 minutes",
  retry: {
    maximumAttempts: 2,
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

export async function runFeedsRefreshWorkflow(): Promise<FeedsRefreshSummary> {
  return await triggerFeedsRefresh();
}
