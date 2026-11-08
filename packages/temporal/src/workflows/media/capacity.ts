import {
  ActivityCancellationType,
  proxyActivities,
} from "@temporalio/workflow";
import type { CapacityActivities } from "@shepherdjerred/media/capacity";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  Pick<CapacityActivities, "observeMediaCapacityMounts">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "45 seconds",
  scheduleToCloseTimeout: "90 seconds",
  heartbeatTimeout: "40 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});
const files = proxyActivities<Pick<CapacityActivities, "sampleMediaCapacity">>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "20 seconds",
  scheduleToCloseTimeout: "55 seconds",
  heartbeatTimeout: "15 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

export async function observeMediaCapacityWorkflow() {
  const mounts = await network.observeMediaCapacityMounts();
  return mounts.status === "observed"
    ? await files.sampleMediaCapacity(mounts.cycle)
    : mounts;
}
