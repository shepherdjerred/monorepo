import { patched, proxyActivities } from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

/**
 * Once per dispatch tick, after the accepted-selection observations: a
 * drained retained host is proposed for guarded retirement (AI-472). Ticks
 * recorded before it replay without the Activity.
 */
export const DELIVERY_AUTO_RETIRE_PATCH = "delivery-auto-retire-v1";

const retirement = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "2 minutes",
  // A proposal is repeated by the next tick, never by a retry.
  retry: { maximumAttempts: 1 },
});

/** The tick's proposal failure, reported after dispatch like an observation failure. */
export async function proposeDrainedRetirements(): Promise<unknown[]> {
  if (!patched(DELIVERY_AUTO_RETIRE_PATCH)) return [];
  try {
    await retirement.retireDrainedWorkerHosts();
    return [];
  } catch (error) {
    return [error];
  }
}
