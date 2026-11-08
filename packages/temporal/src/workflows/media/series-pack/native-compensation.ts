import {
  ActivityCancellationType,
  ApplicationFailure,
  CancellationScope,
  condition,
  proxyActivities,
  sleep,
} from "@temporalio/workflow";
import type {
  SeriesPackNativeFileActivitiesV1,
  SeriesPackNativeNetworkActivitiesV1,
} from "@shepherdjerred/media/native-series-pack-compensation";
import type {
  NativeRecoveryNetworkActivities,
  MediaNetworkActivities,
} from "@shepherdjerred/media/automation";
import { TASK_QUEUES } from "#shared/task-queues.ts";

type Review = Parameters<
  SeriesPackNativeFileActivitiesV1["prepareSeriesPackNativeCompensationV1"]
>[0];
type Apply = Parameters<
  SeriesPackNativeFileActivitiesV1["applySeriesPackNativeCompensationV1"]
>[0];
type Effect = Parameters<
  SeriesPackNativeFileActivitiesV1["compensateSeriesPackNativePublicationV1"]
>[0];
const network = proxyActivities<
  SeriesPackNativeNetworkActivitiesV1 &
    Pick<NativeRecoveryNetworkActivities, "nativeRecoveryState"> &
    Pick<MediaNetworkActivities, "finishMediaOperation">
>({
  taskQueue: TASK_QUEUES.MEDIA_NETWORK,
  startToCloseTimeout: "2 minutes",
  scheduleToCloseTimeout: "5 minutes",
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});
const files = proxyActivities<SeriesPackNativeFileActivitiesV1>({
  taskQueue: TASK_QUEUES.MEDIA_FILES,
  startToCloseTimeout: "12 hours",
  scheduleToCloseTimeout: "25 hours",
  heartbeatTimeout: "1 minute",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 2, initialInterval: "5 seconds" },
});

/** Observation refresh shares the physical scope; failure drains the original executor before settlement. */
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
async function review(input: Review, applying?: Apply) {
  try {
    const state = await network.nativeRecoveryState(input);
    if (
      !state.applied &&
      (applying !== undefined || state.state !== "awaiting_review")
    )
      await withRefresh(
        () =>
          applying === undefined
            ? files.prepareSeriesPackNativeCompensationV1(input)
            : files.applySeriesPackNativeCompensationV1(applying),
        () => network.observeSeriesPackNativeCompensationV1(input),
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
        success ? null : "series_pack_native_compensation_review_protected",
      );
      return success;
    });
    if (!settled) throw error;
  }
}
export async function prepare(input: Review) {
  await review({ planId: input.planId, operationId: input.operationId });
}
export async function apply(input: Apply) {
  const command = {
    planId: input.planId,
    operationId: input.operationId,
    planHash: input.planHash,
  };
  await review(
    { planId: command.planId, operationId: command.operationId },
    command,
  );
}
function effect(input: Effect): Effect {
  return {
    schemaVersion: input.schemaVersion,
    continuationId: input.continuationId,
    operationId: input.operationId,
    recoveryEpoch: input.recoveryEpoch,
  };
}
export async function compensate(raw: Effect) {
  const input = effect(raw);
  try {
    const prior = await network.seriesPackNativeCompensationStateV1(input);
    if (prior.state === "compensated") {
      await finish(input.operationId, true, null);
      return;
    }
    const observation =
      await network.observeSeriesPackNativeCompensationExecutionV1(input);
    if (observation.status !== "ready") {
      await finish(
        input.operationId,
        observation.status === "compensated",
        observation.reason,
      );
      return;
    }
    const result = await withRefresh(
      () => files.compensateSeriesPackNativePublicationV1(input),
      async () => {
        const fresh =
          await network.observeSeriesPackNativeCompensationExecutionV1(input);
        if (fresh.status !== "ready")
          throw ApplicationFailure.nonRetryable(
            "Series pack compensation execution evidence changed",
            "SeriesPackCompensationEvidenceChanged",
          );
      },
    );
    await finish(
      input.operationId,
      result.status === "compensated",
      result.reason,
    );
  } catch (error) {
    const settled = await CancellationScope.nonCancellable(async () => {
      const state = await network.seriesPackNativeCompensationStateV1(input);
      const success = state.state === "compensated";
      await finish(
        input.operationId,
        success,
        success ? null : "series_pack_native_compensation_execution_protected",
      );
      return success;
    });
    if (!settled) throw error;
  }
}
export async function publish(raw: Effect) {
  const input = effect(raw);
  try {
    const prior = await network.seriesPackNativeCompensationStateV1(input);
    if (prior.publicationVerified) {
      await finish(input.operationId, true, null);
      return;
    }
    for (let poll = 0; poll < 30; poll++) {
      const result = await network.publishSeriesPackNativeCompensationV1(input);
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
      "series_pack_compensation_plex_verification_pending",
    );
  } catch (error) {
    const settled = await CancellationScope.nonCancellable(async () => {
      const state = await network.seriesPackNativeCompensationStateV1(input);
      await finish(
        input.operationId,
        state.publicationVerified,
        state.publicationVerified
          ? null
          : "series_pack_compensation_plex_verification_protected",
      );
      return state.publicationVerified;
    });
    if (!settled) throw error;
  }
}
