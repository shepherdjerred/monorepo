// Frozen pre-replication dispatch tick: keep these commands independent of the
// production Workflow and queue constants so replay can catch drift.
import { proxyActivities } from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";

const metadata = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "30 seconds",
  },
});
const qualification = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

export async function deliveryDispatchWorkflow() {
  const [
    qualified,
    dispatched,
    recovered,
    minecraftRecovered,
    forumQualified,
    forumBaseline,
    platformRecovered,
  ] = await Promise.allSettled([
    qualification.qualifyDeliveryBuilds(),
    metadata.dispatchPendingDeliveries(),
    metadata.dispatchDeliveryWorkerRecoveries(),
    metadata.dispatchDeliveryMinecraftRecoveries(),
    qualification.qualifyDeliveryForumBundles(),
    metadata.dispatchDeliveryForumBaselines(),
    metadata.dispatchDeliveryPlatformRecoveries(),
  ]);
  if (dispatched.status === "rejected") throw dispatched.reason;
  if (qualified.status === "rejected") throw qualified.reason;
  if (recovered.status === "rejected") throw recovered.reason;
  if (minecraftRecovered.status === "rejected") throw minecraftRecovered.reason;
  if (forumQualified.status === "rejected") throw forumQualified.reason;
  if (forumBaseline.status === "rejected") throw forumBaseline.reason;
  if (platformRecovered.status === "rejected") throw platformRecovered.reason;
  return dispatched.value;
}
