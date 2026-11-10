// Frozen worker recovery inspection recorded before transient failures were
// retried on their own bounded schedule: one observation Activity of three
// attempts, then the failure record. Keep these commands independent of the
// production Workflow and queue constants so replay catches drift.
import { CancellationScope, proxyActivities } from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";

const metadata = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "30 seconds",
  },
});
const observation = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "25 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10 seconds",
    maximumInterval: "30 seconds",
  },
});

export async function deliveryWorkerRecoveryWorkflow(input: {
  intentId: string;
}): Promise<void> {
  try {
    await observation.inspectDeliveryWorkerRecovery(input.intentId);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await metadata.failDeliveryWorkerRecovery(input.intentId);
    });
    throw error;
  }
}
