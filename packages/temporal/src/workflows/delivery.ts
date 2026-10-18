import {
  CancellationScope,
  isCancellation,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type { DeliveryActivities } from "#activities/delivery/index.ts";
import type { PlatformDeliveryActivities } from "#activities/delivery/platform/index.ts";
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
const platform = proxyActivities<PlatformDeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY_PLATFORM,
  startToCloseTimeout: "135 minutes",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
});
const controlPlane = proxyActivities<PlatformDeliveryActivities>({
  taskQueue: TASK_QUEUES.DELIVERY_PLATFORM,
  startToCloseTimeout: "135 minutes",
  scheduleToCloseTimeout: "150 minutes",
  heartbeatTimeout: "1 minute",
  // Continuations inspect the same persisted native Job UID; they never repeat a missing Job.
  retry: {
    maximumAttempts: 10,
    initialInterval: "5 seconds",
    maximumInterval: "30 seconds",
  },
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
    if (ready.trmnlRepair) {
      const evidence = await mutation.applyDeliveryTrmnlPlugins(
        input.deploymentId,
      );
      await metadata.finishDelivery(input.deploymentId, {
        status: "succeeded",
        evidence,
      });
      return;
    }
    if (ready.controlPlane) {
      const evidence = await controlPlane.executeDeliveryControlPlane(
        input.deploymentId,
      );
      await metadata.finishDelivery(input.deploymentId, {
        status: "succeeded",
        evidence,
      });
      return;
    }
    if (ready.platform) {
      const evidence = await platform.executeDeliveryPlatform(
        input.deploymentId,
      );
      await metadata.finishDelivery(input.deploymentId, {
        status: "succeeded",
        evidence,
      });
      return;
    }
    if (ready.workerHosts)
      await jobs.inspectDeliveryWorkerImages(input.deploymentId);
    if (ready.minecraftUpgrade) {
      let preservation = await jobs.preserveDeliveryMinecraft(
        input.deploymentId,
      );
      while (preservation.status === "waiting") {
        await sleep("30 seconds");
        preservation = await jobs.preserveDeliveryMinecraft(input.deploymentId);
      }
    }
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
    if (ready.scoutSite)
      evidence.push(
        ...(await mutation.applyDeliveryScoutSite(input.deploymentId)),
      );
    if (ready.trmnlPlugins)
      evidence.push(
        ...(await mutation.applyDeliveryTrmnlPlugins(input.deploymentId)),
      );
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

export async function deliveryPlatformRecoveryWorkflow(input: {
  intentId: string;
}): Promise<void> {
  try {
    await platform.inspectDeliveryPlatformRecovery(input.intentId);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await metadata.failDeliveryPlatformRecovery(input.intentId);
    });
    throw error;
  }
}

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

export async function deliveryMinecraftRecoveryWorkflow(input: {
  intentId: string;
}): Promise<void> {
  try {
    await jobs.recoverDeliveryMinecraft(input.intentId);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await metadata.failDeliveryMinecraftRecovery(input.intentId);
    });
    throw error;
  }
}

export async function deliveryForumBaselineWorkflow(input: {
  intentId: string;
}): Promise<void> {
  try {
    await observation.observeDeliveryForumBaseline(input.intentId);
  } catch (error) {
    await CancellationScope.nonCancellable(async () => {
      await metadata.failDeliveryForumBaseline(input.intentId);
    });
    throw error;
  }
}
