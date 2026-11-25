import { proxyActivities } from "@temporalio/workflow";
import type {
  FlagInventoryActivities,
  FlagInventoryResult,
} from "#activities/flag-inventory-sync.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { checkFlagInventory } = proxyActivities<FlagInventoryActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "1 minute",
    backoffCoefficient: 2,
    maximumInterval: "5 minutes",
  },
});

export async function runFlagInventorySync(): Promise<FlagInventoryResult[]> {
  return await checkFlagInventory();
}
