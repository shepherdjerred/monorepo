// Frozen model step executor recorded before self-hosted handoff (D8): every
// model deployment, self-hosted or not, accepted, finished and settled
// itself. Keep these commands independent of the production Workflow and
// queue constants so replay catches drift.
import { patched, proxyActivities } from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";

const delivery = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "2 minutes",
});

export async function deliveryDeploymentWorkflow(input: {
  deploymentId: string;
}): Promise<void> {
  const id = input.deploymentId;
  const ready = await delivery.prepareDelivery(id);
  if (ready.status !== "ready") return;
  if (!ready.model || !patched("delivery-model-executor-v1")) return;
  const plan = await delivery.planDeliveryModel(id);
  for (const key of plan.keys.slice(plan.resumeAt)) {
    await delivery.renewDeliveryLease(id);
    await delivery.runDeliveryModelStep(id, key);
  }
  const accepted = await delivery.acceptDeliveryModel(id);
  await delivery.finishDelivery(id, {
    status: "succeeded",
    evidence: accepted,
  });
  await delivery.settleDeliveryModel(id);
}
