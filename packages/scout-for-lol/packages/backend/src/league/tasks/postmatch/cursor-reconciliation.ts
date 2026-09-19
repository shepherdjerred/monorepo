import type { IngestedMatchCursorReconciliation } from "@scout-for-lol/temporal";
import { LeaguePuuidSchema, MatchIdSchema } from "@scout-for-lol/data/index.ts";

import { prisma, updateLastProcessedMatch } from "#src/database/index.ts";
import { liveDurableFacts } from "#src/durable/match/live-facts.ts";
import { recordCursorAdvanced } from "#src/durable/match/progression-facts.ts";
import { logger } from "#src/logger.ts";

/**
 * Move a discovering account past a match that was already ingested by someone
 * else.
 *
 * Match children are keyed one-per-match and permanently, so a match whose
 * child already COMPLETED can never be started again. If the account that
 * rediscovered it never had its own cursor advanced, discovery returns the same
 * match on every poll and the account can never reach anything newer. Failing
 * that poll leaves the account stuck; completing it quietly leaves the account
 * stuck too. Advancing the cursor is the only outcome that ends the loop.
 *
 * The tracked-account association is the proof, and ingestion is the only thing
 * that writes it: its presence means this match reached ingestion with this
 * account recorded as a participant. Without it the match may still be in
 * flight, and advancing past an unfinished match would drop it permanently —
 * the same hazard `processMatchAndUpdatePlayers` guards when it refuses to move
 * the cursor ahead of an incomplete authoritative write.
 *
 * Advancing is monotonic by construction rather than by comparison: discovery
 * only returns matches that fall after the account's current cursor, so the
 * only match reaching this function is one the account has not passed yet.
 */
export async function reconcileIngestedMatchCursor(input: {
  matchId: string;
  sourcePuuid: string;
}): Promise<IngestedMatchCursorReconciliation> {
  const matchId = MatchIdSchema.parse(input.matchId);
  const puuid = LeaguePuuidSchema.parse(input.sourcePuuid);

  const association = await prisma.matchTrackedAccount.findUnique({
    where: { riotMatchId_puuid: { riotMatchId: matchId, puuid } },
    select: { cursorAdvancedAt: true },
  });
  if (association === null) {
    logger.warn(
      `[cursorReconciliation] ${matchId} has no tracked-account record for ${puuid}; leaving the cursor where it is`,
    );
    return { outcome: "not-ingested" };
  }

  logger.info(
    `[cursorReconciliation] ${matchId} is already ingested for ${puuid}; advancing the stale cursor past it`,
  );
  await updateLastProcessedMatch(puuid, matchId);
  await recordCursorAdvanced({ facts: liveDurableFacts(), matchId, puuid });
  return { outcome: "reconciled" };
}
