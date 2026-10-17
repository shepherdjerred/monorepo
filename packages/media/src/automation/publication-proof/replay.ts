import type { FileContext } from "#automation/files/types.ts";
import type { PublicationIntentRef } from "#shared/publication-proof/intent.ts";
import type { PublicationEffect } from "#shared/publication-proof/effects.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { PublicationEffectState } from "./effect-state.ts";
import { publicationForwardSteps } from "./steps.ts";
import { publicationInverse, type InverseAction } from "./inverse.ts";

/** Replays only actual durable events. It never upgrades these JSON values into a ContentProof. */
export function replayPublication(
  context: FileContext,
  intent: PublicationIntentRef,
  records: readonly PublicationEffect[],
  inverse?: { continuationId: string | null },
) {
  const state = new PublicationEffectState(
    intent,
    publicationForwardSteps(context, intent.intent),
  );
  let actions: InverseAction[] = [];
  let inverseNamespace: string | null | undefined;
  for (const record of records) {
    const next = state.next;
    const startsInverse = record.effect.operationId.startsWith("recover-");
    if (
      startsInverse &&
      (inverseNamespace === undefined ||
        inverseNamespace !== record.continuationId)
    ) {
      if (inverse === undefined)
        throw new FileOperationConflict(
          "Compensated publication cannot resume forward effects",
        );
      actions = publicationInverse(context, state, record.continuationId);
      state.replaceRemaining(actions.flatMap((action) => action.events));
      inverseNamespace = record.continuationId;
    } else if (
      next?.continuationId !== undefined &&
      next.continuationId !== record.continuationId
    ) {
      throw new FileOperationConflict(
        "Publication inverse namespace changed unexpectedly",
      );
    }
    state.accept(record);
  }
  // Re-derive only work remaining after the complete durable prefix. In
  // particular a complete inverse journal awaiting its PG commit is no new IO.
  if (inverse !== undefined) {
    actions = publicationInverse(context, state, inverse.continuationId);
    state.replaceRemaining(actions.flatMap((action) => action.events));
  }
  return { state, actions };
}
