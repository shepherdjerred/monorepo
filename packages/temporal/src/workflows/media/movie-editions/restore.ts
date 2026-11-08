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
import {
  finishMovieOperationV4 as finish,
  recoverableMovieOperationV4 as recoverable,
} from "./lifecycle.ts";

type Input = Parameters<MovieFileActivitiesV4["restoreMovieFilesV4"]>[0];
const network = proxyActivities<
  Pick<
    MovieNetworkActivitiesV4,
    "publishRestoredMovieToPlexV4" | "finalizeMovieRestorationV4"
  >
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});
const files = proxyActivities<
  Pick<MovieFileActivitiesV4, "restoreMovieFilesV4">
>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

/** Physical restoration and a fresh verified Plex binding precede logical completion. */
export function restoreMovieEditionV4Workflow(
  raw: Input,
): Promise<MediaWorkflowResult> {
  const input: Input = {
    schemaVersion: raw.schemaVersion,
    operationId: raw.operationId,
    mediaId: raw.mediaId,
    generation: raw.generation,
    scope: {
      rootMediaId: raw.scope.rootMediaId,
      mediaId: raw.scope.mediaId,
      edition: raw.scope.edition,
    },
  };
  return recoverable(input.operationId, async () => {
    const physical = await files.restoreMovieFilesV4(input);
    if (physical.status !== "restored")
      return finish(input.operationId, {
        status: "blocked",
        ...(physical.reason === undefined ? {} : { reason: physical.reason }),
      });
    for (let poll = 0; poll < 30; poll++) {
      const published = await network.publishRestoredMovieToPlexV4(input);
      if (published.status === "available") {
        await network.finalizeMovieRestorationV4(input);
        return finish(input.operationId, { status: "completed" });
      }
      if (published.status !== "waiting")
        return finish(input.operationId, {
          status: published.status,
          ...(published.reason === null ? {} : { reason: published.reason }),
        });
      await sleep("1 minute");
    }
    return finish(input.operationId, {
      status: "blocked",
      reason: "movie_plex_restore_unconfirmed",
    });
  });
}
