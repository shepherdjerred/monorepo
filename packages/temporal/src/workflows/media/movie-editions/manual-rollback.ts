import {
  ActivityCancellationType,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type {
  RequestedMovieRollbackFileActivitiesV1,
  RequestedMovieRollbackNetworkActivitiesV1,
} from "@shepherdjerred/media/movie-rollback";
import type { MediaWorkflowResult } from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  finishMovieOperationV4,
  recoverableMovieOperationV4,
} from "./lifecycle.ts";

type Input = Parameters<
  RequestedMovieRollbackFileActivitiesV1["prepareRequestedMovieRollbackV1"]
>[0];
const files = proxyActivities<RequestedMovieRollbackFileActivitiesV1>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  heartbeatTimeout: "30 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});
const network = proxyActivities<RequestedMovieRollbackNetworkActivitiesV1>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

/** Distinct owner command; the old successful acquisition remains literal. */
export function rollbackMovieEditionV1Workflow(
  raw: Input,
): Promise<MediaWorkflowResult> {
  const input: Input = {
    schemaVersion: raw.schemaVersion,
    operationId: raw.operationId,
    sourceAttemptId: raw.sourceAttemptId,
    scope: raw.scope,
    ...("resume" in raw ? { resume: raw.resume } : {}),
  };
  return recoverableMovieOperationV4(input.operationId, () => rollback(input));
}

async function rollback(input: Input): Promise<MediaWorkflowResult> {
  const blocked = (reason: string) =>
    finishMovieOperationV4(input.operationId, { status: "blocked", reason });
  const admission = await network.observeRequestedMovieRollbackV1(input);
  if (admission.status !== "ready")
    return blocked(admission.reason ?? "movie_rollback_playback_protected");
  const prepared = await files.prepareRequestedMovieRollbackV1(input);
  if (prepared.status !== "prepared")
    return blocked(prepared.reason ?? "movie_rollback_admission_protected");
  const current = await network.observeRequestedMovieRollbackV1(input);
  if (current.status !== "ready")
    return blocked(current.reason ?? "movie_rollback_playback_protected");
  const physical = await files.rollbackRequestedMoviePublicationV1(input);
  if (physical.status !== "physically_rolled_back")
    return blocked(physical.reason ?? "movie_rollback_files_protected");
  for (let poll = 0; poll < 30; poll++) {
    const verified = await network.verifyRequestedMovieRollbackV1(input);
    if (verified.status === "available")
      return finishMovieOperationV4(input.operationId, { status: "completed" });
    if (verified.status !== "waiting")
      return blocked(verified.reason ?? "movie_rollback_plex_protected");
    await sleep("1 minute");
  }
  return blocked("movie_rollback_plex_unverified");
}
