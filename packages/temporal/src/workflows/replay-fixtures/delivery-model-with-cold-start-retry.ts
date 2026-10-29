// Frozen model deployment path recorded while the cold-start write retried
// until it landed: prepare, the step executor, acceptance, the retry marker,
// then the cold-start write and its receipt. Keep these commands independent
// of the production Workflow and queue constants so replay catches drift.
import { patched, proxyActivities } from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";

/** The retired cold-start activities, as this history recorded them. */
type ColdStartActivities = {
  settleDeliveryModel: (deploymentId: string) => Promise<unknown>;
  recordDeliveryColdStart: (
    deploymentId: string,
    receipt: unknown,
  ) => Promise<void>;
};
type BackupActivities = {
  writeDeliveryColdStart: (write: unknown) => Promise<unknown>;
};

const metadata = proxyActivities<DeliveryActivities>({
  taskQueue: "delivery",
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "30 seconds",
  },
});
const coldStart = proxyActivities<ColdStartActivities>({
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
const backup = proxyActivities<BackupActivities>({
  taskQueue: "backup",
  startToCloseTimeout: "2 minutes",
  retry: { initialInterval: "10 seconds", maximumInterval: "10 minutes" },
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
  const write = await coldStart.settleDeliveryModel(input.deploymentId);
  if (write !== null && patched("delivery-cold-start-retry-v1"))
    await coldStart.recordDeliveryColdStart(
      input.deploymentId,
      await backup.writeDeliveryColdStart(write),
    );
}
