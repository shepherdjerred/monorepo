// Frozen dispatch tick recorded after replication and before monitor and
// drift observation existed, with nothing awaiting replication. Keep these
// commands independent of the production Workflow and queue constants so
// replay catches drift.
import { patched, proxyActivities } from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";

const delivery = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

const TICK = [
  "qualifyDeliveryBuilds",
  "dispatchPendingDeliveries",
  "dispatchDeliveryWorkerRecoveries",
  "dispatchDeliveryMinecraftRecoveries",
  "qualifyDeliveryForumBundles",
  "dispatchDeliveryForumBaselines",
  "dispatchDeliveryPlatformRecoveries",
] as const;

export async function deliveryDispatchWorkflow() {
  if (patched("delivery-dispatch-replication-v1"))
    await delivery.listDeliveryReplications();
  await Promise.allSettled(TICK.map(async (name) => await delivery[name]()));
}
