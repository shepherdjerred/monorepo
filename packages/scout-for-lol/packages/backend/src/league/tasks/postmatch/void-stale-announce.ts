import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { announceSettlements } from "#src/betting/notify/announce.ts";
import { refreshClosedBucksMessages } from "#src/betting/notify/message-refresh.ts";
import {
  listStaleBettingPools,
  voidStaleBettingPools,
} from "#src/betting/settlement/void-stale.ts";
import { postmatchReplyTargets } from "#src/temporal/v2/notification/settlement-notification.ts";

/**
 * Void the pools whose match never resolved, then refresh and announce them.
 * One maintenance step, because the announcement consumes the void's result.
 *
 * The reply targets are read BEFORE the void, and that order matters. The
 * void is irreversible: once a pool is voided it is no longer stale, so no
 * later pass would announce it again. A lookup that failed after the void
 * would leave its recap unsent for good. Read first, a failing lookup throws
 * out of this step with every pool untouched, and the next maintenance pass
 * retries the whole thing. The void then works from the same list of pools
 * whose targets were read.
 *
 * A pool keyed by something other than a Riot match id has no post-match
 * report to reply to, so its recap stands alone. The reply targets are the
 * delivered post-match intents, which every pipeline records.
 */
export async function voidStaleAndAnnounce(): Promise<void> {
  const now = new Date();
  const stale = await listStaleBettingPools(undefined, now);
  const replyTargets = new Map<string, ReadonlyMap<string, string>>();
  for (const matchId of new Set(stale.map((pool) => pool.matchId))) {
    const parsed = RiotMatchIdSchema.safeParse(matchId);
    replyTargets.set(
      matchId,
      parsed.success ? await postmatchReplyTargets(parsed.data) : new Map(),
    );
  }

  const staleBucks = await voidStaleBettingPools(undefined, now, stale);
  const staleMatchIds = new Set([
    ...staleBucks.closures.map((closure) => closure.matchId),
    ...staleBucks.settlements.map((settlement) => settlement.matchId),
  ]);
  await refreshClosedBucksMessages([
    ...staleBucks.closures,
    ...staleBucks.settlements,
  ]);
  for (const matchId of staleMatchIds) {
    const postmatchMessageIds = replyTargets.get(matchId);
    if (postmatchMessageIds === undefined) {
      throw new Error(
        `The stale void returned match ${matchId}, which was not among the pools it was handed`,
      );
    }
    await announceSettlements({
      matchId,
      closures: staleBucks.closures.filter(
        (closure) => closure.matchId === matchId,
      ),
      settlements: staleBucks.settlements.filter(
        (settlement) => settlement.matchId === matchId,
      ),
      parlaySettlements: [],
      earnings: [],
      postmatchMessageIds,
    });
  }
}
