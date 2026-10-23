// Frozen model deployment path recorded before the cold-start write retried
// until it lands: prepare, the step executor, acceptance, then a cold-start
// write bounded to five attempts. Keep these commands independent of the
// production Workflow and queue constants so replay catches drift.
import { patched, proxyActivities } from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";
import type { DeliveryColdStartActivities } from "#activities/delivery/model/cold-start.ts";

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
const jobs = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "135 minutes",
  heartbeatTimeout: "5 minutes",
  retry: { maximumAttempts: 1 },
});
const backup = proxyActivities<DeliveryColdStartActivities>({
  taskQueue: "backup",
  scheduleToCloseTimeout: "10 minutes",
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 5, initialInterval: "10 seconds" },
});

export async function deliveryDeploymentWorkflow(input: {
  deploymentId: string;
}): Promise<void> {
  const ready = await metadata.prepareDelivery(input.deploymentId);
  if (ready.status !== "ready") return;
  if (!ready.model || !patched("delivery-model-executor-v1")) return;
  const plan = await metadata.planDeliveryModel(input.deploymentId);
  for (const key of plan.keys.slice(plan.resumeAt)) {
    await metadata.renewDeliveryLease(input.deploymentId);
    await jobs.runDeliveryModelStep(input.deploymentId, key);
  }
  const evidence = await observation.acceptDeliveryModel(input.deploymentId);
  await metadata.finishDelivery(input.deploymentId, {
    status: "succeeded",
    evidence,
  });
  const coldStart = await metadata.settleDeliveryModel(input.deploymentId);
  if (coldStart !== null)
    await metadata.recordDeliveryColdStart(
      input.deploymentId,
      await backup.writeDeliveryColdStart(coldStart),
    );
}
