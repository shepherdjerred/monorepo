import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  proxyActivities,
  isCancellation,
} from "@temporalio/workflow";
import type {
  NativeRecoveryNetworkActivities,
  NativeRecoveryFileActivities,
  NativeRecoveryOperation,
  MediaNetworkActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  NativeRecoveryNetworkActivities &
    Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});
const files = proxyActivities<NativeRecoveryFileActivities>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  heartbeatTimeout: "1 minute",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});

async function runNativeRecovery(
  input: NativeRecoveryOperation,
  apply: boolean,
): Promise<void> {
  const scope = new CancellationScope();
  let fileWork: Promise<void> | undefined;
  try {
    const prior = await network.nativeRecoveryState(input);
    if (!prior.applied && (apply || prior.state !== "awaiting_review")) {
      await scope.run(async () => {
        await network.observeNativeRecovery(input);
        const state = { done: false };
        const execute = async () => {
          try {
            if (apply) await files.applyNativeRecoveryFiles(input);
            else await files.prepareNativeRecoveryFiles(input);
          } finally {
            state.done = true;
          }
        };
        fileWork = execute();
        await Promise.all([
          fileWork,
          refreshNativeRecovery(input, () => state.done),
        ]);
      });
    }
    await network.finishMediaOperation({
      operationId: input.operationId,
      status: "completed",
      reason: null,
    });
  } catch (error) {
    scope.cancel();
    const complete = await CancellationScope.nonCancellable(async () => {
      if (fileWork !== undefined) await Promise.allSettled([fileWork]);
      const state = await network.nativeRecoveryState(input);
      const completed =
        state.applied || (!apply && state.state === "awaiting_review");
      await network.finishMediaOperation({
        operationId: input.operationId,
        status: completed ? "completed" : "reconciling",
        reason: completed
          ? null
          : isCancellation(error)
            ? "native_recovery_cancelled_requires_review"
            : "native_recovery_evidence_requires_review",
      });
      return completed;
    });
    if (!complete) throw error;
  }
}
async function refreshNativeRecovery(
  input: NativeRecoveryOperation,
  done: () => boolean,
): Promise<void> {
  while (!done()) {
    if (await condition(done, "30 seconds")) return;
    try {
      await network.observeNativeRecovery(input);
    } catch (error) {
      if (!done()) throw error;
    }
  }
}
export async function prepareNativeRecoveryWorkflow(
  input: NativeRecoveryOperation,
): Promise<void> {
  await runNativeRecovery(input, false);
}
export async function applyNativeRecoveryWorkflow(
  input: NativeRecoveryOperation,
): Promise<void> {
  await runNativeRecovery(input, true);
}
