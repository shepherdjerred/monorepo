import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createNativeRecoveryObserver } from "#migration/native-network/producer.ts";
import { createNativeQuarantineObserver } from "#migration/native-network/quarantine.ts";
import { createNativeArchiveObserver } from "#migration/native-archive/producer.ts";
import { observeNativeCompensation } from "#migration/native-compensation/producer.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { nativeReviewDispatch } from "./dispatch.ts";
import { observeNativePlex, type NativePlexContext } from "./producer.ts";

/** Exact service-issued command IDs select the immutable protocol before any new external IO. */
export function createNativePlexObserver(context: NativePlexContext) {
  return async (
    command: { planId: string; operationId: string },
    execution: PlexBindingExecution,
  ) => {
    execution.assertActive();
    const input = {
      planId: command.planId,
      operationId: command.operationId,
    };
    const budget = new PublicationAuthorityReadBudget();
    const dispatch = await context.db.$transaction((tx) =>
      nativeReviewDispatch(tx, input, budget),
    );
    execution.assertActive();
    if (dispatch.kind === "complete") return;
    if (dispatch.kind === "paired") {
      await observeNativePlex(context, input, execution, budget);
      return;
    }
    // Only an already-finished v1/v2 apply reaches the unchanged historical serializer.
    await context.qbittorrent.login(execution.signal);
    execution.assertActive();
    switch (dispatch.lifecycleKind) {
      case "published":
        await createNativeRecoveryObserver(context)(input.planId, budget);
        break;
      case "committed_quarantine":
        await createNativeQuarantineObserver(context)(input.planId, budget);
        break;
      case "superseded_archive":
        await createNativeArchiveObserver({
          ...context,
          archiveExecution: () => execution,
        })(input.planId, budget);
        break;
      case "publication_compensation":
        await observeNativeCompensation(context, input, execution, budget);
        break;
    }
    execution.assertActive();
  };
}
