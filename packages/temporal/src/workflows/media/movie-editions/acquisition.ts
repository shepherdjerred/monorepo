import {
  ActivityCancellationType,
  continueAsNew,
  executeChild,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type {
  MovieNetworkActivitiesV4,
  MovieFileActivitiesV4,
} from "@shepherdjerred/media/movie-lifecycle";
import type { MediaWorkflowResult } from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  finishMovieOperationV4 as finish,
  recoverableMovieOperationV4 as recoverable,
} from "./lifecycle.ts";

type Coordinator = Parameters<
  MovieNetworkActivitiesV4["reconcileMovieIntentV4"]
>[0];
type Attempt = Parameters<MovieNetworkActivitiesV4["submitMovieTorrentV4"]>[0];
const network = proxyActivities<MovieNetworkActivitiesV4>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});
const writes = proxyActivities<
  Pick<MovieNetworkActivitiesV4, "submitMovieTorrentV4">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 1 },
});
const files = proxyActivities<MovieFileActivitiesV4>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

/** Additive scoped history; old unscoped coordinators keep their original entry points. */
export function reconcileMovieEditionV4Workflow(
  raw: Coordinator,
): Promise<MediaWorkflowResult> {
  const input = {
    schemaVersion: raw.schemaVersion,
    operationId: raw.operationId,
    mediaId: raw.mediaId,
    scope: raw.scope,
    generation: raw.generation,
  };
  return recoverable(input.operationId, async () => {
    const result = await network.reconcileMovieIntentV4(input);
    if (result.status !== "acquire")
      return finish(input.operationId, {
        status: result.status === "available" ? "completed" : result.status,
        ...(result.reason === null ? {} : { reason: result.reason }),
      });
    if (result.attemptId === null)
      throw new Error("Movie acquisition omitted its actual attempt");
    return executeChild(acquireMovieEditionV4Workflow, {
      workflowId: `media-acquire-${result.attemptId}`,
      args: [
        {
          schemaVersion: 4,
          operationId: input.operationId,
          attemptId: result.attemptId,
          scope: input.scope,
        },
      ],
    });
  });
}

export function acquireMovieEditionV4Workflow(
  raw: Attempt & { submitted?: boolean },
): Promise<MediaWorkflowResult> {
  const input: Attempt = {
    schemaVersion: raw.schemaVersion,
    operationId: raw.operationId,
    attemptId: raw.attemptId,
    scope: raw.scope,
  };
  return recoverable(input.operationId, () =>
    acquire(input, raw.submitted === true),
  );
}

async function acquire(
  input: Attempt,
  submitted: boolean,
): Promise<MediaWorkflowResult> {
  if (!submitted) {
    const submission = await writes.submitMovieTorrentV4(input);
    if (submission.status === "waiting") {
      await sleep("1 minute");
      return continueAsNew<typeof acquireMovieEditionV4Workflow>(input);
    }
    if (submission.status !== "submitted")
      return finish(input.operationId, {
        status: submission.status,
        ...(submission.reason === null ? {} : { reason: submission.reason }),
      });
  }
  return awaitDownload(input);
}

async function awaitDownload(input: Attempt): Promise<MediaWorkflowResult> {
  for (let poll = 0; poll < 100; poll++) {
    const observed = await network.observeMovieAcquisitionV4(input);
    if (observed.status === "ready")
      return observed.reason === "resume_committed_publication"
        ? publishPlex(input)
        : publishFiles(input);
    if (observed.status !== "downloading")
      return finish(input.operationId, {
        status: observed.status,
        ...(observed.reason === null ? {} : { reason: observed.reason }),
      });
    await sleep("1 minute");
  }
  return continueAsNew<typeof acquireMovieEditionV4Workflow>({
    ...input,
    submitted: true,
  });
}

async function publishFiles(input: Attempt): Promise<MediaWorkflowResult> {
  const staged = await files.inspectAndStageMovieV4(input);
  if (staged.status !== "staged")
    return finish(input.operationId, {
      status: "blocked",
      reason: staged.reason ?? "movie_staging_protected",
    });
  const published = await files.promoteMovieFilesV4(input);
  if (published.status !== "published")
    return finish(input.operationId, {
      status: "blocked",
      reason: published.reason ?? "movie_publication_protected",
    });
  return publishPlex(input);
}

async function publishPlex(input: Attempt): Promise<MediaWorkflowResult> {
  for (let poll = 0; poll < 30; poll++) {
    const published = await network.publishMovieToPlexV4(input);
    if (published.status === "available") {
      await network.finalizeMovieAcquisitionV4(input);
      return finish(input.operationId, { status: "completed" });
    }
    if (published.status !== "waiting")
      return finish(input.operationId, {
        status: "blocked",
        reason: published.reason ?? "movie_plex_publication_protected",
      });
    await sleep("1 minute");
  }
  return continueAsNew<typeof acquireMovieEditionV4Workflow>({
    ...input,
    submitted: true,
  });
}
