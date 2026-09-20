import type {
  IngestedMatchCursorReconciliation,
  ScoutMatchIngestionInput,
} from "@scout-for-lol/temporal";
import { scoutMatchWorkflowId } from "@scout-for-lol/temporal";
import { LeaguePuuidSchema, MatchIdSchema } from "@scout-for-lol/data/index.ts";

import { prisma, updateLastProcessedMatch } from "#src/database/index.ts";
import { liveDurableFacts } from "#src/durable/match/live-facts.ts";
import { recordCursorAdvanced } from "#src/durable/match/progression-facts.ts";
import { logger } from "#src/logger.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";

/**
 * Move a discovering account past a match that another execution already
 * ingested.
 *
 * Match children are keyed one-per-match and permanently, so a match whose
 * child already COMPLETED can never be started again. If the account that
 * rediscovered it never had its own cursor advanced, discovery returns the same
 * match on every poll and the account can never reach anything newer. Failing
 * that poll leaves the account stuck; completing it quietly leaves the account
 * stuck too. Advancing the cursor is the only outcome that ends the loop.
 *
 * The child's own terminal status is the evidence, because
 * `scoutMatchIngestionWorkflow` completes only once `ingestMatch` has returned
 * — which is to say once archival, settlement, delivery, progression and the
 * cursor loop have all finished. Durable facts cannot stand in for it: they are
 * written fail-open through `recordDurableWrite`, and the tracked-account
 * association in particular is recorded right after archival, long before the
 * rest of ingestion. Trusting it would both strand a completed match whose
 * recorder happened to fail and advance past a match still mid-ingest, which
 * would drop it permanently — the hazard `processMatchAndUpdatePlayers` guards
 * when it refuses to move the cursor ahead of an incomplete authoritative
 * write.
 *
 * Advancing is monotonic by construction rather than by comparison: discovery
 * only returns matches that fall after the account's current cursor, so the
 * only match reaching this function is one the account has not passed yet.
 */
export async function reconcileIngestedMatchCursor(
  input: ScoutMatchIngestionInput,
): Promise<IngestedMatchCursorReconciliation> {
  const matchId = MatchIdSchema.parse(input.matchId);
  const puuid = LeaguePuuidSchema.parse(input.sourcePuuid);
  const childWorkflowId = scoutMatchWorkflowId(input.stage, matchId);

  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) {
    // Reached only from a Workflow running on this worker, which cannot be
    // true without a supervisor. A broken internal contract, not a condition
    // to paper over with a "not completed" answer that would stall the cursor.
    throw new Error(
      `Temporal supervisor is unavailable while reconciling ${childWorkflowId}`,
    );
  }

  // The caller only reaches this after Temporal refused the start because the
  // ID is taken, so the execution exists; a missing one is a broken contract
  // and `describe` throwing is the correct report of it.
  const description = await supervisor
    .client()
    .workflow.getHandle(childWorkflowId)
    .describe();
  if (description.status.name !== "COMPLETED") {
    logger.warn(
      `[cursorReconciliation] ${childWorkflowId} is ${description.status.name}, not COMPLETED; leaving ${puuid}'s cursor where it is`,
    );
    return { outcome: "not-completed" };
  }

  logger.info(
    `[cursorReconciliation] ${childWorkflowId} completed already; advancing ${puuid}'s stale cursor past ${matchId}`,
  );
  await updateLastProcessedMatch(puuid, matchId, prisma);
  await recordCursorAdvanced({ facts: liveDurableFacts(), matchId, puuid });
  return { outcome: "reconciled" };
}
