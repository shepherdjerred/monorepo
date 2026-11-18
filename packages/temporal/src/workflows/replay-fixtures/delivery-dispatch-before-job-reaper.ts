// Frozen dispatch tick recorded with auto-retire and monitor observation,
// before settled-Job reaping existed.
import { patched, proxyActivities } from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";

const delivery = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

export async function deliveryDispatchWorkflow() {
  patched("drop-delivery-replication-v1");
  await Promise.allSettled([
    delivery.qualifyDeliveryBuilds(),
    delivery.dispatchPendingDeliveries(),
    delivery.dispatchDeliveryWorkerRecoveries(),
    patched("drop-minecraft-recovery-dispatch-v1")
      ? Promise.resolve()
      : delivery.dispatchDeliveryMinecraftRecoveries(),
    delivery.qualifyDeliveryForumBundles(),
    delivery.dispatchDeliveryForumBaselines(),
    delivery.dispatchDeliveryPlatformRecoveries(),
  ]);
  if (patched("delivery-dispatch-model-v1")) {
    await Promise.allSettled([
      delivery.observeDeliveryMonitors(),
      delivery.observeDeliveryDrift(),
      delivery.removeDeliveryTargets(),
    ]);
  }
  if (patched("delivery-auto-retire-v1")) {
    await delivery.retireDrainedWorkerHosts();
  }
}
