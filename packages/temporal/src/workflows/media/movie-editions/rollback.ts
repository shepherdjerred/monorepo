import {
  ActivityCancellationType,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type {
  MovieFileActivitiesV4,
  MovieNetworkActivitiesV4,
} from "@shepherdjerred/media/movie-lifecycle";
import type { MediaWorkflowResult } from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { finishMovieOperationV4 } from "./lifecycle.ts";

type Input = Parameters<MovieFileActivitiesV4["prepareMovieRollbackV4"]>[0];
const files = proxyActivities<
  Pick<
    MovieFileActivitiesV4,
    "prepareMovieRollbackV4" | "rollbackMoviePublicationV4"
  >
>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});
const network = proxyActivities<
  Pick<MovieNetworkActivitiesV4, "verifyRolledBackMoviePlexV4">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

/** Only the new history branch calls this. Actual Network failure and private
 * admission parents are validated by Files before the first inverse effect. */
export async function rollbackFailedMoviePublicationV4(
  input: Input,
  failureReason: string,
): Promise<MediaWorkflowResult> {
  const finish = (reason: string) =>
    finishMovieOperationV4(input.operationId, {
      status: "blocked",
      reason,
    });
  const prepared = await files.prepareMovieRollbackV4(input);
  if (prepared.status !== "prepared")
    return finish(prepared.reason ?? "movie_rollback_admission_protected");
  const rolledBack = await files.rollbackMoviePublicationV4(input);
  if (rolledBack.status !== "physically_rolled_back")
    return finish(rolledBack.reason ?? "movie_rollback_files_protected");
  for (let poll = 0; poll < 30; poll++) {
    const verified = await network.verifyRolledBackMoviePlexV4(input);
    if (verified.status === "available") return finish(failureReason);
    if (verified.status !== "waiting")
      return finish(verified.reason ?? "movie_rollback_plex_protected");
    await sleep("1 minute");
  }
  return finish("movie_rollback_plex_unverified");
}
