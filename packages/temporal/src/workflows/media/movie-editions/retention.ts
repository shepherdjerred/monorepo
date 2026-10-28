import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  isCancellation,
  proxyActivities,
  sleep,
  continueAsNew,
  ContinueAsNew,
} from "@temporalio/workflow";
import type {
  MovieFileActivitiesV4,
  MovieNetworkActivitiesV4,
} from "@shepherdjerred/media/movie-lifecycle";
import type {
  MediaNetworkActivities,
  MediaWorkflowResult,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";

type Input = Parameters<
  MovieNetworkActivitiesV4["evaluateMovieRetentionV4"]
>[0];
type Evaluation = Awaited<
  ReturnType<MovieNetworkActivitiesV4["evaluateMovieRetentionV4"]>
>;
const observe = proxyActivities<
  Pick<MovieNetworkActivitiesV4, "evaluateMovieRetentionV4">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "45 seconds",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  retry: { maximumAttempts: 1 },
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
});
const files = proxyActivities<
  Pick<MovieFileActivitiesV4, "quarantineMovieFilesV4" | "purgeMovieFilesV4">
>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
});
const network = proxyActivities<
  Pick<
    MovieNetworkActivitiesV4,
    "evaluateMovieRetentionV4" | "completeMovieRemovalV4"
  > &
    Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "5 minutes",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 3,
  },
});

/** Additive history; normalized Activity bodies exclude outbox-only metadata. */
export async function retainMovieEditionV4Workflow(
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
  try {
    return await retain(input);
  } catch (error) {
    if (error instanceof ContinueAsNew) throw error;
    await CancellationScope.nonCancellable(() =>
      network.finishMediaOperation({
        operationId: input.operationId,
        status: "reconciling",
        reason: isCancellation(error)
          ? "movie_retention_cancelled_requires_reconciliation"
          : "movie_retention_failed_requires_reconciliation",
      }),
    );
    throw error;
  }
}

async function finish(operationId: string, result: MediaWorkflowResult) {
  await network.finishMediaOperation({
    operationId,
    status: result.status === "waiting" ? "reconciling" : "completed",
    reason: result.reason ?? null,
  });
  return result;
}

async function retain(input: Input): Promise<MediaWorkflowResult> {
  for (let poll = 0; poll < 100; poll++) {
    const result = await network.evaluateMovieRetentionV4(input);
    const terminal = await retentionStep(input, result);
    if (terminal !== null) return finish(input.operationId, terminal);
    const delay =
      result.wakeAt === null
        ? 60_000
        : Math.max(1000, new Date(result.wakeAt).getTime() - Date.now());
    await sleep(delay);
  }
  return continueAsNew<typeof retainMovieEditionV4Workflow>(input);
}

async function retentionStep(
  input: Input,
  result: Evaluation,
): Promise<MediaWorkflowResult | null> {
  if (result.status === "protected")
    return protectedResult("waiting", result.reason);
  if (result.status === "obsolete")
    return protectedResult("obsolete", result.reason);
  if (result.status === "complete") return { status: "completed" };
  if (result.status === "quarantine" || result.status === "purge") {
    if (result.decisionId === null)
      throw new Error("Movie removal requires a retention decision");
    const removed = await executeFreshRetention(input, {
      decisionId: result.decisionId,
      status: result.status,
    });
    if (removed.status === "protected")
      return protectedResult("waiting", removed.reason);
    const completion = await network.completeMovieRemovalV4({
      schemaVersion: 4,
      operationId: input.operationId,
      decisionId: result.decisionId,
      scope: input.scope,
      stage: removed.status,
    });
    if (completion.status === "obsolete")
      return protectedResult("obsolete", completion.reason);
    if (removed.status === "purged") return { status: "completed" };
  }
  return null;
}

function protectedResult(
  status: "waiting" | "obsolete",
  reason: string | null | undefined,
): MediaWorkflowResult {
  return { status, ...(reason == null ? {} : { reason }) };
}

async function executeFreshRetention(
  input: Input,
  decision: { decisionId: string; status: "quarantine" | "purge" },
) {
  const scope = new CancellationScope();
  const state = { done: false };
  const isDone = () => state.done;
  return await scope.run(async () => {
    const operation = {
      schemaVersion: 4 as const,
      operationId: input.operationId,
      decisionId: decision.decisionId,
      scope: input.scope,
    };
    const work = async () => {
      try {
        return await (decision.status === "purge"
          ? files.purgeMovieFilesV4(operation)
          : files.quarantineMovieFilesV4(operation));
      } finally {
        state.done = true;
      }
    };
    const refresh = async () => {
      while (!isDone()) {
        await condition(isDone, "20 seconds");
        if (isDone()) return;
        const current = await observe.evaluateMovieRetentionV4(input);
        if (
          !isDone() &&
          (current.decisionId !== decision.decisionId ||
            current.status !== decision.status)
        )
          throw new Error(
            "Movie retention authority changed during file verification",
          );
      }
    };
    const fileWork = work();
    const observer = refresh();
    try {
      const [result] = await Promise.all([fileWork, observer]);
      return result;
    } catch (error) {
      scope.cancel();
      await Promise.allSettled([fileWork, observer]);
      if (isCancellation(error)) throw error;
      return {
        status: "protected" as const,
        reason: "movie_retention_refresh_failed_requires_reconciliation",
      };
    }
  });
}
