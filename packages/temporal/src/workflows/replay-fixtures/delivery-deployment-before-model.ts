// Frozen ordinary deployment path recorded before the model step executor
// existed: prepare, apply, verify, finish. Keep these commands independent of
// the production Workflow and queue constants so replay catches drift.
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
const mutation = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "25 minutes",
  heartbeatTimeout: "5 minutes",
  retry: { maximumAttempts: 1 },
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

export async function deliveryDeploymentWorkflow(input: {
  deploymentId: string;
}): Promise<void> {
  const ready = await metadata.prepareDelivery(input.deploymentId);
  if (ready.status !== "ready") return;
  await mutation.applyDelivery(input.deploymentId);
  const evidence = await observation.verifyDelivery(input.deploymentId);
  await metadata.finishDelivery(input.deploymentId, {
    status: "succeeded",
    evidence,
  });
}
