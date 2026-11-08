import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type {
  NativeCompensationNetworkActivities,
  NativeCompensationFileActivities,
  NativeCompensationPrepareInput,
  NativeCompensationApplyInput,
  NativeCompensationActivityInput,
} from "@shepherdjerred/media/native-compensation";
import type {
  NativeRecoveryNetworkActivities,
  MediaNetworkActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const network = proxyActivities<
  NativeCompensationNetworkActivities &
    Pick<NativeRecoveryNetworkActivities, "nativeRecoveryState"> &
    Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});
const files = proxyActivities<NativeCompensationFileActivities>({
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
  let physical: Promise<T> | undefined;
  try {
    return await scope.run(async () => {
      await observe();
      let done = false;
      physical = (async () => {
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
      const [result] = await Promise.all([physical, refresh()]);
      return result;
    });
  } catch (error) {
    scope.cancel();
    await CancellationScope.nonCancellable(async () => {
      if (physical !== undefined) await Promise.allSettled([physical]);
    });
    throw error;
  }
}

async function review(
  input: NativeCompensationPrepareInput,
  applying?: NativeCompensationApplyInput,
) {
  try {
    const state = await network.nativeRecoveryState(input);
    if (
      !state.applied &&
      (applying !== undefined || state.state !== "awaiting_review")
    )
      await withRefresh(
        () =>
          applying === undefined
            ? files.prepareNativeCompensationFiles(input)
            : files.applyNativeCompensationFiles(applying),
        () => network.observeNativeCompensation(input),
      );
    await finish(input.operationId, true, null);
  } catch (error) {
    const settled = await CancellationScope.nonCancellable(async () => {
      const state = await network.nativeRecoveryState(input);
      const success =
        state.applied ||
        (applying === undefined && state.state === "awaiting_review");
      await finish(
        input.operationId,
        success,
        success ? null : "native_compensation_review_protected",
      );
      return success;
    });
    if (!settled) throw error;
  }
}
export async function prepare(input: NativeCompensationPrepareInput) {
  await review({ planId: input.planId, operationId: input.operationId });
}
export async function apply(input: NativeCompensationApplyInput) {
  const command = {
    planId: input.planId,
    operationId: input.operationId,
    planHash: input.planHash,
  };
  await review(command, command);
}

export async function compensate(
  raw: NativeCompensationActivityInput,
): Promise<void> {
  const input = activityInput(raw);
  try {
    const prior = await network.nativeCompensationState(input);
    if (prior.state === "compensated") {
      await finish(input.operationId, true, null);
      return;
    }
    const observation = await network.observeNativeCompensationExecution(input);
    if (observation.status !== "ready") {
      await finish(
        input.operationId,
        observation.status === "compensated",
        observation.reason,
      );
      return;
    }
    const result = await withRefresh(
      () => files.compensateNativePublicationFiles(input),
      async () => {
        const fresh = await network.observeNativeCompensationExecution(input);
        if (fresh.status !== "ready")
          throw new Error("Compensation execution evidence changed");
      },
    );
    await finish(
      input.operationId,
      result.status === "compensated",
      result.reason,
    );
  } catch (error) {
    const settled = await CancellationScope.nonCancellable(async () => {
      const state = await network.nativeCompensationState(input);
      const success = state.state === "compensated";
      await finish(
        input.operationId,
        success,
        success ? null : "native_compensation_execution_protected",
      );
      return success;
    });
    if (!settled) throw error;
  }
}

/** Only the separately stored, freshly authorized household publication command reaches here. */
export async function publish(
  raw: NativeCompensationActivityInput,
): Promise<void> {
  const input = activityInput(raw);
  try {
    const prior = await network.nativeCompensationState(input);
    if (prior.publicationVerified) {
      await finish(input.operationId, true, null);
      return;
    }
    for (let poll = 0; poll < 30; poll++) {
      const result = await network.publishCompensatedMedia(input);
      if (result.status !== "waiting") {
        await finish(
          input.operationId,
          result.status === "available",
          result.reason,
        );
        return;
      }
      await sleep("1 minute");
    }
    await finish(
      input.operationId,
      false,
      "compensation_plex_verification_pending",
    );
  } catch (error) {
    const settled = await CancellationScope.nonCancellable(async () => {
      const state = await network.nativeCompensationState(input);
      await finish(
        input.operationId,
        state.publicationVerified,
        state.publicationVerified
          ? null
          : "compensation_plex_verification_protected",
      );
      return state.publicationVerified;
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

function activityInput(
  input: NativeCompensationActivityInput,
): NativeCompensationActivityInput {
  return {
    schemaVersion: input.schemaVersion,
    continuationId: input.continuationId,
    operationId: input.operationId,
    recoveryEpoch: input.recoveryEpoch,
  };
}
