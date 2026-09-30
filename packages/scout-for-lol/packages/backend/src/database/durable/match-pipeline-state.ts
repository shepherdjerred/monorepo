import type { Db } from "#src/database/index.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type {
  MatchDeliveryMode,
  MatchProcessingState,
} from "@scout-for-lol/domain/match-processing/states.ts";
import {
  getObservation,
  getProcessingState,
} from "#src/database/durable/observation-repository.ts";
import { listIntentsForMatch } from "#src/database/durable/intent-repository.ts";
import { listTrackedAccounts } from "#src/database/durable/tracked-account-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import type { MatchTrackedAccountRecord } from "#src/database/durable/tracked-account-row.ts";

/**
 * The whole durable picture of one match, in one read.
 *
 * `getProcessingState` assembles the pure domain machine's state: owner,
 * policy, promotion, receipts. A Workflow resuming a match needs two more
 * things that machine does not model — the notification intents minted for it
 * and the tracked accounts whose cursors it moves — and it needs them in the
 * same read, because reconstructing them from per-key lookups requires knowing
 * the intent keys before it can ask about them, which is the thing it is
 * asking about.
 *
 * This is a SIBLING of `getProcessingState` rather than a widening of
 * `MatchProcessingState`. That type is the domain's, its schema is closed, and
 * its uniqueness invariant is about receipts; intents and tracked-account
 * associations are repository-side facts that no pure transition moves. Adding
 * them to the domain state would put rows the machine cannot reason about
 * inside the value the machine validates.
 *
 * Records are returned whole, not summarised, and that matters most for
 * `MatchTrackedAccount.accountId`. NULL means the PUUID was tracked but not
 * registered when the match was observed; a NON-NULL id whose Account row no
 * longer exists means it was registered then and has been deregistered since.
 * Those are different histories with different remedies, and a summary that
 * reported "no account" for both would destroy the distinction here, where it
 * is still recoverable.
 */
export type MatchPipelineState = {
  readonly processing: MatchProcessingState;
  /**
   * Whether this match is owed a public delivery, as the first observer
   * recorded it.
   *
   * A sibling of `processing` for the same reason the intents are: it is a
   * column of the observation, not a state the domain machine transitions
   * between, and a resumed run needs it in this same read — it is what tells a
   * restart that carries no discovery pass behind it whether the match may
   * announce itself at all.
   */
  readonly deliveryMode: MatchDeliveryMode;
  readonly intents: readonly MatchNotificationIntentRecord[];
  readonly trackedAccounts: readonly MatchTrackedAccountRecord[];
};

/**
 * Read one match's pipeline state, or `null` when nothing has observed it.
 *
 * Absence is keyed on the observation alone. Intents and tracked-account rows
 * are recorded against a match that was observed, so a match with neither is
 * still a match this pipeline has seen; a match with no observation has not
 * been seen at all, and there is no state to resume from.
 */
export async function getMatchPipelineState(
  db: Db,
  args: { matchId: RiotMatchId },
): Promise<MatchPipelineState | null> {
  const processing = await getProcessingState(db, args);
  if (processing === null) {
    return null;
  }
  const [observation, intents, trackedAccounts] = await Promise.all([
    // Re-read rather than widen `MatchProcessingState`: the delivery mode is
    // an observation column, and the point read runs beside the other two
    // rather than after them.
    getObservation(db, args),
    listIntentsForMatch(db, args),
    listTrackedAccounts(db, args),
  ]);
  if (observation === null) {
    throw new Error(
      `MatchObservation ${args.matchId} vanished between its processing state and its delivery mode`,
    );
  }
  return {
    processing,
    deliveryMode: observation.deliveryMode,
    intents,
    trackedAccounts,
  };
}
