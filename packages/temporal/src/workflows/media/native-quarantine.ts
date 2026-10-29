import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  proxyActivities,
  isCancellation,
  sleep,
} from "@temporalio/workflow";
import type {
  NativeQuarantineNetworkActivities,
  NativeQuarantineFileActivities,
  NativeRecoveryNetworkActivities,
  NativeRecoveryOperation,
  NativeQuarantineRestoreOperation,
  MediaNetworkActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";

const network = proxyActivities<
  NativeQuarantineNetworkActivities &
    Pick<NativeRecoveryNetworkActivities, "nativeRecoveryState"> &
    Pick<
      MediaNetworkActivities,
      "finishMediaOperation" | "publishRestoredMedia"
    >
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});
const files = proxyActivities<NativeQuarantineFileActivities>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  scheduleToCloseTimeout: HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS,
  heartbeatTimeout: "1 minute",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});

async function refresh(
  input: NativeRecoveryOperation,
  done: () => boolean,
): Promise<void> {
  while (!done()) {
    if (await condition(done, "30 seconds")) return;
    try {
      await network.observeNativeQuarantine(input);
    } catch (error) {
      if (!done()) throw error;
    }
  }
}
async function run(
  input: NativeRecoveryOperation,
  applying: boolean,
): Promise<void> {
  const scope = new CancellationScope();
  let fileWork: Promise<void> | undefined;
  try {
    const prior = await network.nativeRecoveryState(input);
    if (!prior.applied && (applying || prior.state !== "awaiting_review")) {
      await scope.run(async () => {
        await network.observeNativeQuarantine(input);
        const state = { done: false };
        fileWork = (async () => {
          try {
            if (applying) await files.applyNativeQuarantineFiles(input);
            else await files.prepareNativeQuarantineFiles(input);
          } finally {
            state.done = true;
          }
        })();
        await Promise.all([fileWork, refresh(input, () => state.done)]);
      });
    }
    await network.finishMediaOperation({
      operationId: input.operationId,
      status: "completed",
      reason: null,
    });
  } catch (error) {
    scope.cancel();
    const completed = await CancellationScope.nonCancellable(async () => {
      if (fileWork !== undefined) await Promise.allSettled([fileWork]);
      const state = await network.nativeRecoveryState(input);
      const success =
        state.applied || (!applying && state.state === "awaiting_review");
      await network.finishMediaOperation({
        operationId: input.operationId,
        status: success ? "completed" : "reconciling",
        reason: success
          ? null
          : isCancellation(error)
            ? "native_quarantine_cancelled_requires_review"
            : "native_quarantine_evidence_requires_review",
      });
      return success;
    });
    if (!completed) throw error;
  }
}
export async function prepare(input: NativeRecoveryOperation): Promise<void> {
  await run(input, false);
}
export async function apply(input: NativeRecoveryOperation): Promise<void> {
  await run(input, true);
}
export async function restore(
  input: NativeQuarantineRestoreOperation,
): Promise<void> {
  try {
    const restored = await files.restoreNativeQuarantineFiles(input);
    if (restored.status !== "restored") {
      await network.finishMediaOperation({
        operationId: input.operationId,
        status: "reconciling",
        reason: restored.reason ?? "native_quarantine_restore_protected",
      });
      return;
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      const published = await network.publishRestoredMedia(input);
      if (published.status === "available") {
        await network.finishMediaOperation({
          operationId: input.operationId,
          status: "completed",
          reason: null,
        });
        return;
      }
      if (published.status === "blocked") {
        await network.finishMediaOperation({
          operationId: input.operationId,
          status: "reconciling",
          reason: published.reason ?? "native_quarantine_publication_protected",
        });
        return;
      }
      await sleep("1 minute");
    }
    await network.finishMediaOperation({
      operationId: input.operationId,
      status: "reconciling",
      reason: "plex_restore_unconfirmed",
    });
  } catch (error) {
    await CancellationScope.nonCancellable(() =>
      network.finishMediaOperation({
        operationId: input.operationId,
        status: "reconciling",
        reason: isCancellation(error)
          ? "native_quarantine_restore_cancelled"
          : "native_quarantine_restore_requires_review",
      }),
    );
    throw error;
  }
}
