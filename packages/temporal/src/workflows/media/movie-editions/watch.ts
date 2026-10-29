import {
  ActivityCancellationType,
  proxyActivities,
} from "@temporalio/workflow";
import type { MovieWatchActivitiesV4 } from "@shepherdjerred/media/movie-lifecycle";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  MovieWatchActivitiesV4 & Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

export async function observeMoviePlexHintV4Workflow(
  input: Parameters<MovieWatchActivitiesV4["observeMoviePlexHintV4"]>[0],
) {
  const result = await network.observeMoviePlexHintV4(input);
  await network.finishMediaOperation({
    operationId: input.operationId,
    status: "completed",
    reason: result.status === "observed" ? null : result.status,
  });
  return result;
}
