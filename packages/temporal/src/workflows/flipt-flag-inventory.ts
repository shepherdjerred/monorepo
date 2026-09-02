import { proxyActivities } from "@temporalio/workflow";
import type {
  FliptFlagInventoryActivities,
  FliptFlagInventoryResult,
} from "#activities/flipt-flag-inventory.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { checkFliptFlagInventory } =
  proxyActivities<FliptFlagInventoryActivities>({
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    startToCloseTimeout: "2 minutes",
    retry: {
      maximumAttempts: 3,
      initialInterval: "1 minute",
      backoffCoefficient: 2,
      maximumInterval: "5 minutes",
    },
  });

export async function runFliptFlagInventory(): Promise<
  FliptFlagInventoryResult[]
> {
  return await checkFliptFlagInventory();
}
