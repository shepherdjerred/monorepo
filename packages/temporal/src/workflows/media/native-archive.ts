import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  isCancellation,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type {
  NativeArchiveNetworkActivities,
  NativeArchiveFileActivities,
  NativeArchivePrepareInput,
  NativeArchiveApplyInput,
  CleanupNativeArchiveInput,
} from "@shepherdjerred/media/native-archive";
import type {
  NativeRecoveryNetworkActivities,
  MediaNetworkActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  NativeArchiveNetworkActivities &
    Pick<NativeRecoveryNetworkActivities, "nativeRecoveryState"> &
    Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});
const files = proxyActivities<NativeArchiveFileActivities>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  scheduleToCloseTimeout: "25 hours",
  heartbeatTimeout: "1 minute",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});

async function withRefresh<T>(
  work: () => Promise<T>,
  observe: () => Promise<void>,
): Promise<T> {
  const scope = new CancellationScope();
  let fileWork: Promise<T> | undefined;
  try {
    return await scope.run(async () => {
      await observe();
      let done = false;
      fileWork = (async () => {
        try {
          return await work();
        } finally {
          done = true;
        }
      })();
      const refresh = async () => {
        while (!(await condition(() => done, "30 seconds"))) {
          try {
            await observe();
          } catch (error) {
            if (!done) throw error;
          }
        }
      };
      const [result] = await Promise.all([fileWork, refresh()]);
      return result;
    });
  } catch (error) {
    scope.cancel();
    await CancellationScope.nonCancellable(async () => {
      if (fileWork !== undefined) await Promise.allSettled([fileWork]);
    });
    throw error;
  }
}

async function run(
  input: NativeArchivePrepareInput,
  applyInput?: NativeArchiveApplyInput,
): Promise<void> {
  const applying = applyInput !== undefined;
  try {
    const prior = await network.nativeRecoveryState(input);
    if (!prior.applied && (applying || prior.state !== "awaiting_review"))
      await withRefresh(
        () =>
          applyInput === undefined
            ? files.prepareNativeArchiveFiles(input)
            : files.applyNativeArchiveFiles(applyInput),
        () => network.observeNativeArchive(input),
      );
    await finish(input.operationId, true, null);
  } catch (error) {
    const settled = await CancellationScope.nonCancellable(async () => {
      const state = await network.nativeRecoveryState(input);
      const success =
        state.applied || (!applying && state.state === "awaiting_review");
      await finish(
        input.operationId,
        success,
        success ? null : "native_archive_evidence_requires_review",
      );
      return success;
    });
    if (!settled) throw error;
  }
}
export async function prepare(input: NativeArchivePrepareInput): Promise<void> {
  await run(input);
}
export async function apply(input: NativeArchiveApplyInput): Promise<void> {
  await run(input, input);
}

export async function cleanup(input: CleanupNativeArchiveInput): Promise<void> {
  try {
    const state = await network.nativeArchiveCleanupState(input);
    if (state.state === "superseded") {
      await finish(
        input.operationId,
        true,
        "native_archive_approval_superseded",
      );
      return;
    }
    if (state.state === "cleaned") {
      await finish(input.operationId, true, null);
      return;
    }
    const delay = Date.parse(state.expiresAt) - Date.now();
    if (delay > 0) await sleep(delay);
    const observed = await network.observeNativeArchiveCleanup(input);
    if (observed.status !== "ready") {
      await finish(
        input.operationId,
        observed.status === "cleaned",
        observed.reason ?? null,
      );
      return;
    }
    const result = await withRefresh(
      () => files.cleanupNativeArchiveFiles(input),
      async () => {
        const evidence = await network.observeNativeArchiveCleanup(input);
        if (evidence.status !== "ready")
          throw new Error("Archive cleanup evidence changed");
      },
    );
    await finish(
      input.operationId,
      result.status === "cleaned",
      result.reason ?? null,
    );
  } catch (error) {
    const settled = await CancellationScope.nonCancellable(async () => {
      const state = await network.nativeArchiveCleanupState(input);
      if (state.state === "superseded") {
        await finish(
          input.operationId,
          true,
          "native_archive_approval_superseded",
        );
        return true;
      }
      const success = state.state === "cleaned";
      await finish(
        input.operationId,
        success,
        success
          ? null
          : isCancellation(error)
            ? "native_archive_cleanup_cancelled"
            : "native_archive_cleanup_requires_review",
      );
      return success;
    });
    if (!settled) throw error;
  }
}
async function finish(
  operationId: string,
  success: boolean,
  reason: string | null,
) {
  await network.finishMediaOperation({
    operationId,
    status: success ? "completed" : "reconciling",
    reason,
  });
}
