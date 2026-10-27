import {
  ActivityCancellationType,
  continueAsNew,
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
  finishMovieOperationV4,
  recoverableMovieOperationV4,
} from "./lifecycle.ts";

type Input = Parameters<MovieNetworkActivitiesV4["findMovieSubtitlesV4"]>[0];
const network = proxyActivities<
  Pick<MovieNetworkActivitiesV4, "findMovieSubtitlesV4">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 1 },
});
const files = proxyActivities<
  Pick<MovieFileActivitiesV4, "installMovieSubtitlesV4">
>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

/** Quota-bearing downloads use their existing durable journal; uncertain outcomes never blindly retry. */
export function acquireMovieSubtitlesV4Workflow(
  raw: Input,
): Promise<MediaWorkflowResult> {
  const input: Input = {
    schemaVersion: raw.schemaVersion,
    operationId: raw.operationId,
    assetId: raw.assetId,
    scope: raw.scope,
    recoveryEpoch: raw.recoveryEpoch,
    language: raw.language,
    targetAuthority: raw.targetAuthority,
    ...(raw.forced === undefined ? {} : { forced: raw.forced }),
    ...(raw.hearingImpaired === undefined
      ? {}
      : { hearingImpaired: raw.hearingImpaired }),
  };
  return recoverableMovieOperationV4(input.operationId, () =>
    acquireSubtitles(input),
  );
}

async function acquireSubtitles(input: Input): Promise<MediaWorkflowResult> {
  for (let poll = 0; poll < 28; poll++) {
    const found = await network.findMovieSubtitlesV4(input);
    if (found.status === "found") {
      if (found.subtitleId === null)
        throw new Error("Movie captions omitted their actual candidate ID");
      return installSubtitles(input, found.subtitleId);
    }
    if (found.status !== "waiting")
      return finishMovieOperationV4(input.operationId, {
        status: found.status,
        ...(found.reason === null ? {} : { reason: found.reason }),
      });
    await sleep(
      found.reason === "subtitle_browser_pending" ? "30 seconds" : "6 hours",
    );
  }
  return continueAsNew<typeof acquireMovieSubtitlesV4Workflow>(input);
}

async function installSubtitles(
  input: Input,
  subtitleId: string,
): Promise<MediaWorkflowResult> {
  const installed = await files.installMovieSubtitlesV4({
    schemaVersion: 4,
    operationId: input.operationId,
    assetId: input.assetId,
    scope: input.scope,
    subtitleId,
  });
  return finishMovieOperationV4(input.operationId, {
    status: installed.status === "installed" ? "completed" : "blocked",
    ...(installed.reason === undefined ? {} : { reason: installed.reason }),
  });
}
