// Retained coordinator before completed-provider progress; replay must retain
// its original Activity and continue-as-new arguments even with additive results.
import {
  ActivityCancellationType,
  continueAsNew,
  executeChild,
  patched,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type { MovieNetworkActivitiesV4 } from "@shepherdjerred/media/movie-lifecycle";
import type { MediaWorkflowResult } from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  finishMovieOperationV4 as finish,
  recoverableMovieOperationV4 as recoverable,
} from "./lifecycle.ts";
import { acquireMovieEditionV4Workflow as acquireCurrentMovie } from "./acquisition.ts";

export function acquireMovieEditionV4Workflow(
  raw: Parameters<typeof acquireCurrentMovie>[0],
): Promise<MediaWorkflowResult> {
  return acquireCurrentMovie(raw);
}
type Coordinator = Parameters<
  MovieNetworkActivitiesV4["reconcileMovieIntentV4"]
>[0];
const network = proxyActivities<MovieNetworkActivitiesV4>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  scheduleToStartTimeout: "30 seconds",
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "3 minutes",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "2 seconds" },
});

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
    if (
      result.status === "waiting" &&
      result.reason === "provider_deferred" &&
      patched("movie-provider-admission-deferral-v1")
    ) {
      const delay = result.retryAfterSeconds;
      if (delay === undefined || !Number.isSafeInteger(delay) || delay <= 0)
        throw new Error("Provider admission deferral lost its retry deadline");
      await sleep(delay * 1000);
      return continueAsNew<typeof reconcileMovieEditionV4Workflow>(input);
    }
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
