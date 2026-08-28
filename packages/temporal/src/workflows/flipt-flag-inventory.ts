import { proxyActivities } from "@temporalio/workflow";
import type {
  FliptFlagInventoryActivities,
  FliptFlagInventoryResult,
} from "#activities/flipt-flag-inventory.ts";

const { checkFliptFlagInventory } =
  proxyActivities<FliptFlagInventoryActivities>({
    startToCloseTimeout: "2 minutes",
    retry: {
      maximumAttempts: 3,
      initialInterval: "1 minute",
      backoffCoefficient: 2,
      maximumInterval: "5 minutes",
    },
  });

export async function runFliptFlagInventory(): Promise<FliptFlagInventoryResult> {
  return await checkFliptFlagInventory();
}
