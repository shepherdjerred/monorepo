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
  MediaFileActivities,
  MediaNetworkActivities,
  MediaOperation,
  MediaWorkflowResult,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";

const observe = proxyActivities<
  Pick<MediaNetworkActivities, "evaluateMediaRetention">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "45 seconds",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  retry: { maximumAttempts: 1 },
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
});
const files = proxyActivities<
  Pick<MediaFileActivities, "quarantineMediaFiles" | "purgeMediaFiles">
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
    MediaNetworkActivities,
    "evaluateMediaRetention" | "finishMediaOperation"
  >
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

export async function retainMediaWorkflow(
  input: MediaOperation,
): Promise<MediaWorkflowResult> {
  try {
    return await retain(input);
  } catch (error) {
    if (error instanceof ContinueAsNew) throw error;
    await CancellationScope.nonCancellable(() =>
      network.finishMediaOperation({
        operationId: input.operationId,
        status: "reconciling",
        reason: isCancellation(error)
          ? "retention_cancelled_requires_reconciliation"
          : "retention_failed_requires_reconciliation",
      }),
    );
    throw error;
  }
}

async function finish(
  operationId: string,
  result: MediaWorkflowResult,
): Promise<MediaWorkflowResult> {
  await network.finishMediaOperation({
    operationId,
    status: result.status === "waiting" ? "reconciling" : "completed",
    reason: result.reason ?? null,
  });
  return result;
}

async function retain(input: MediaOperation): Promise<MediaWorkflowResult> {
  for (let poll = 0; poll < 100; poll++) {
    const result = await network.evaluateMediaRetention(input);
    const terminal = await retentionStep(input, result);
    if (terminal !== null) return finish(input.operationId, terminal);
    const delay =
      result.wakeAt === null
        ? 60_000
        : Math.max(1000, new Date(result.wakeAt).getTime() - Date.now());
    await sleep(delay);
  }
  return continueAsNew<typeof retainMediaWorkflow>(input);
}

async function retentionStep(
  input: MediaOperation,
  result: Awaited<ReturnType<MediaNetworkActivities["evaluateMediaRetention"]>>,
): Promise<MediaWorkflowResult | null> {
  if (result.status === "protected")
    return protectedResult("waiting", result.reason);
  if (result.status === "obsolete")
    return protectedResult("obsolete", result.reason);
  if (result.status === "complete") return { status: "completed" };
  if (result.status === "quarantine" || result.status === "purge") {
    if (result.decisionId === null)
      throw new Error("Removal requires a retention decision");
    const removed = await executeFreshRetention(input, {
      decisionId: result.decisionId,
      status: result.status,
    });
    if (removed.status === "purged") return { status: "completed" };
    if (removed.status === "protected")
      return protectedResult("waiting", removed.reason);
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
  input: MediaOperation,
  decision: { decisionId: string; status: "quarantine" | "purge" },
): Promise<
  | Awaited<ReturnType<MediaFileActivities["purgeMediaFiles"]>>
  | Awaited<ReturnType<MediaFileActivities["quarantineMediaFiles"]>>
> {
  const scope = new CancellationScope();
  const state = { done: false };
  const isDone = () => state.done;
  return await scope.run(async () => {
    const operation = {
      operationId: input.operationId,
      decisionId: decision.decisionId,
    };
    const work = async () => {
      try {
        return await (decision.status === "purge"
          ? files.purgeMediaFiles(operation)
          : files.quarantineMediaFiles(operation));
      } finally {
        state.done = true;
      }
    };
    const refresh = async () => {
      while (!isDone()) {
        await condition(isDone, "20 seconds");
        if (isDone()) return;
        const current = await observe.evaluateMediaRetention(input);
        if (
          !isDone() &&
          (current.decisionId !== decision.decisionId ||
            current.status !== decision.status)
        )
          throw new Error(
            "Retention authority changed during file verification",
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
        status: "protected",
        reason: "retention_refresh_failed_requires_reconciliation",
      };
    }
  });
}
