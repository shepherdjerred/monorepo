import {
  CancellationScope,
  isCancellation,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const metadata = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "30 seconds",
  },
});
const mutation = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "25 minutes",
  heartbeatTimeout: "1 minute",
  // A worker crash or lost subprocess receipt requires inspection, not a repeat write.
  retry: { maximumAttempts: 1 },
});
const observation = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "25 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "10 seconds",
    maximumInterval: "30 seconds",
  },
});
const jobs = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "135 minutes",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
});
const qualification = proxyActivities<DeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});

export async function deliveryDeploymentWorkflow(input: {
  deploymentId: string;
}): Promise<void> {
  let claimed = false;
  try {
    let ready = await metadata.prepareDelivery(input.deploymentId);
    while (ready.status === "waiting") {
      await sleep("30 seconds");
      ready = await metadata.prepareDelivery(input.deploymentId);
    }
    if (ready.status === "terminal") return;
    claimed = true;
    await mutation.applyDelivery(input.deploymentId);
    if (ready.workerRollout) {
      const plan = await jobs.prepareDeliveryWorker(input.deploymentId);
      await jobs.stepDeliveryWorker(input.deploymentId, plan, "start");
      await sleep("30 minutes");
      await jobs.stepDeliveryWorker(input.deploymentId, plan, "advance-50");
      await sleep("2 hours");
      await jobs.stepDeliveryWorker(input.deploymentId, plan, "advance-100");
      await sleep("2 hours");
      await jobs.stepDeliveryWorker(input.deploymentId, plan, "promote");
      await jobs.stepDeliveryWorker(input.deploymentId, plan, "verify");
    }
    const evidence = await observation.verifyDelivery(input.deploymentId);
    await metadata.finishDelivery(input.deploymentId, {
      status: "succeeded",
      evidence,
    });
  } catch (error) {
    if (!claimed) throw error;
    await CancellationScope.nonCancellable(async () => {
      await metadata.finishDelivery(input.deploymentId, {
        status: isCancellation(error) ? "canceled" : "failed",
        evidence: [],
      });
    });
    throw error;
  }
}

export async function deliveryDispatchWorkflow() {
  const [qualified, dispatched] = await Promise.allSettled([
    qualification.qualifyDeliveryBuilds(),
    metadata.dispatchPendingDeliveries(),
  ]);
  if (dispatched.status === "rejected") throw dispatched.reason;
  if (qualified.status === "rejected") throw qualified.reason;
  return dispatched.value;
}
