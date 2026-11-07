import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import type { SeriesPackNativeFileExecutionV1 } from "#shared/native-recovery/series-pack/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { loadSeriesPackNativeReviewPhaseV1 } from "#infrastructure/native-compensation/series-pack/review-phase.ts";
import { loadSeriesPackNativePlexV1 } from "#infrastructure/native-compensation/series-pack/plex-records.ts";
import {
  finishSeriesPackNativePreparationV1,
  applySeriesPackNativeApprovalV1,
} from "#infrastructure/native-compensation/series-pack/approval.ts";
import {
  SeriesPackNativeReviewV1Schema,
  SeriesPackNativeApplyV1Schema,
  type SeriesPackNativeReviewV1,
  type SeriesPackNativeApplyV1,
} from "#shared/native-recovery/series-pack/runtime.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { readSeriesPackNativeReviewAckV1 } from "#infrastructure/native-compensation/series-pack/review-ack.ts";
import { discoverSeriesPackNativeV1 } from "./discovery.ts";
import { captureSeriesPackNativeProofV1 } from "./proof.ts";
import { withSeriesPackNativeReviewPathsV1 } from "./review-paths.ts";
import {
  seriesPackNativeFileContextV1,
  seriesPackNativeBindingExecutionV1,
} from "./execution.ts";

type Invocation = {
  execution: SeriesPackNativeFileExecutionV1;
  budget: PublicationAuthorityReadBudget;
};

async function approve(
  initial: NativeFileContext,
  input: SeriesPackNativeReviewV1 | SeriesPackNativeApplyV1,
  invocation: Invocation,
) {
  const { execution, budget } = invocation;
  const context = seriesPackNativeFileContextV1(initial, execution);
  if (
    await context.files.db.$transaction((tx) =>
      readSeriesPackNativeReviewAckV1(
        tx,
        input,
        budget,
        "planHash" in input ? "apply" : "prepare",
      ),
    )
  ) {
    execution.assertActive();
    return;
  }
  const discovery = await discoverSeriesPackNativeV1(
    context.files.db,
    input,
    seriesPackNativeBindingExecutionV1(execution),
    budget,
  );
  const measured = await captureSeriesPackNativeProofV1(
    context,
    discovery.scope,
    { planId: input.planId, budget },
  );
  discovery.freshness.assertActive();
  await context.files.db.$transaction(
    async (tx) => {
      const phase = await loadSeriesPackNativeReviewPhaseV1(tx, input, budget);
      discovery.freshness.assertActive();
      if (
        identityHash(nativeJson(phase.operation)) !== discovery.operationHash ||
        identityHash(nativeJson(phase.plan)) !== discovery.planHash ||
        identityHash(phase.scope) !== identityHash(discovery.scope)
      )
        throw new Error(
          "Native pack prelock measurement changed before its full current phase",
        );
      const proof = await loadSeriesPackNativePlexV1(
        tx,
        discovery.ref,
        { transaction: tx, budget, plan: phase.plan },
        discovery.freshness,
      );
      if (
        proof.network.mounts.mounts.some(
          (mount) => mount.podUid !== context.workerPodUid,
        )
      )
        throw new Error(
          "Native pack proof belongs to another actual Files executor",
        );
      await bindPlexTransactionDeadline(tx, discovery.freshness);
      await withSeriesPackNativeReviewPathsV1(measured.context, phase.scope, {
        planId: input.planId,
        action: async () => {
          await measured.assertCurrent();
          discovery.freshness.assertActive();
          if ("planHash" in input)
            await applySeriesPackNativeApprovalV1(tx, context, phase, {
              activity: input,
              files: measured.evidence,
              proof,
              freshness: discovery.freshness,
            });
          else
            await finishSeriesPackNativePreparationV1(tx, phase, {
              files: measured.evidence,
              proof,
              freshness: discovery.freshness,
            });
          await measured.assertCurrent();
          discovery.freshness.assertActive();
        },
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  execution.assertActive();
}

export async function prepareSeriesPackNativeCompensationV1(
  initial: NativeFileContext,
  raw: SeriesPackNativeReviewV1,
  execution: SeriesPackNativeFileExecutionV1,
  budget: PublicationAuthorityReadBudget,
): Promise<void> {
  execution.assertActive();
  await approve(initial, SeriesPackNativeReviewV1Schema.parse(raw), {
    execution,
    budget,
  });
}
export async function applySeriesPackNativeCompensationV1(
  initial: NativeFileContext,
  raw: SeriesPackNativeApplyV1,
  execution: SeriesPackNativeFileExecutionV1,
  budget: PublicationAuthorityReadBudget,
): Promise<void> {
  execution.assertActive();
  await approve(initial, SeriesPackNativeApplyV1Schema.parse(raw), {
    execution,
    budget,
  });
}
