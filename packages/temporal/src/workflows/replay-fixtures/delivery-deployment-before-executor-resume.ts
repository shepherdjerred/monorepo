// Frozen model step executor recorded before a self-hosted step interrupted
// by its own executor's replacement ran again (D8): any step failure,
// `DeliveryExecutorReplaced` included, finished the deployment failed. Keep
// these commands independent of the production Workflow and queue constants
// so replay catches drift.
import {
  CancellationScope,
  patched,
  proxyActivities,
} from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";

const delivery = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

export async function deliveryDeploymentWorkflow(input: {
  deploymentId: string;
}): Promise<void> {
  const id = input.deploymentId;
  const ready = await delivery.prepareDelivery(id);
  if (ready.status !== "ready") return;
  if (!ready.model || !patched("delivery-model-executor-v1")) return;
  try {
    const plan = await delivery.planDeliveryModel(id);
    for (const key of plan.keys.slice(plan.resumeAt)) {
      await delivery.renewDeliveryLease(id);
      await delivery.runDeliveryModelStep(id, key);
    }
    if (plan.handoff && patched("delivery-self-hosted-handoff-v1")) {
      await delivery.handOffDelivery(id);
      return;
    }
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await delivery.finishDelivery(id, { status: "failed", evidence: [] });
    });
    throw error;
  }
}
