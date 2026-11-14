import {
  ActivityCancellationType,
  proxyActivities,
} from "@temporalio/workflow";
import type { PlaybackActivities } from "@shepherdjerred/media/playback";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const playback = proxyActivities<PlaybackActivities>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "50 seconds",
  scheduleToCloseTimeout: "90 seconds",
  heartbeatTimeout: "40 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});
const interests = proxyActivities<
  Pick<PlaybackActivities, "reconcileMediaRequestInterests">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "110 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

/** New Workflow type; no retained acquisition or watch Workflow histories change. */
export async function reconcileMediaPlaybackWorkflow() {
  const observed = await playback.reconcileMediaPlayback();
  const page = await interests.reconcileMediaRequestInterests();
  return { ...observed, processed: page.processed };
}
