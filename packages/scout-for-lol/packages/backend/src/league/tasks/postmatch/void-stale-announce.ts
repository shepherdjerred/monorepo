import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { announceSettlements } from "#src/betting/notify/announce.ts";
import { refreshClosedBucksMessages } from "#src/betting/notify/message-refresh.ts";
import {
  listStaleBettingPools,
  voidStaleBettingPools,
  type StaleBettingPool,
} from "#src/betting/settlement/void-stale.ts";
import { postmatchReplyTargets } from "#src/temporal/v2/notification/settlement-notification.ts";

/**
 * Void the pools whose match never resolved, then refresh and announce them,
 * one match at a time.
 *
 * Inside each match the reply targets are read BEFORE the void, and that
 * order matters. The void is irreversible: once a pool is voided it is no
 * longer stale, so no later pass would announce it again. A lookup that
 * failed after the void would leave its recap unsent for good. Read first, a
 * failing lookup leaves that match's pools untouched for the next pass.
 *
 * Matches are isolated from each other. One match whose stored intents
 * cannot be read must not keep every other match's stakes escrowed, so each
 * match's failure is caught and the rest carry on. The failures are rethrown
 * together at the end, naming the matches, so a corrupt contract still fails
 * the maintenance step loudly and is retried.
 *
 * A pool keyed by something other than a Riot match id has no post-match
 * report to reply to, so its recap stands alone. The reply targets are the
 * delivered post-match intents, which every pipeline records.
 */
export async function voidStaleAndAnnounce(): Promise<void> {
  const now = new Date();
  const byMatch = new Map<string, StaleBettingPool[]>();
  for (const pool of await listStaleBettingPools(undefined, now)) {
    const group = byMatch.get(pool.matchId) ?? [];
    group.push(pool);
    byMatch.set(pool.matchId, group);
  }

  const failures: { matchId: string; error: unknown }[] = [];
  for (const [matchId, pools] of byMatch) {
    try {
      await voidAndAnnounceMatch(matchId, pools, now);
    } catch (error) {
      failures.push({ matchId, error });
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `Stale-pool void failed for match(es) ${failures.map((failure) => failure.matchId).join(", ")}; their pools are untouched or partially voided and are retried next pass`,
    );
  }
}

async function voidAndAnnounceMatch(
  matchId: string,
  pools: readonly StaleBettingPool[],
  now: Date,
): Promise<void> {
  const parsed = RiotMatchIdSchema.safeParse(matchId);
  const postmatchMessageIds: ReadonlyMap<string, string> = parsed.success
    ? await postmatchReplyTargets(parsed.data)
    : new Map();

  const staleBucks = await voidStaleBettingPools(undefined, now, pools);
  const closures = staleBucks.closures.filter(
    (closure) => closure.matchId === matchId,
  );
  const settlements = staleBucks.settlements.filter(
    (settlement) => settlement.matchId === matchId,
  );
  if (
    closures.length !== staleBucks.closures.length ||
    settlements.length !== staleBucks.settlements.length
  ) {
    throw new Error(
      `The stale void for match ${matchId} returned pools of another match`,
    );
  }
  await refreshClosedBucksMessages([...closures, ...settlements]);
  if (closures.length === 0 && settlements.length === 0) return;
  await announceSettlements({
    matchId,
    closures,
    settlements,
    parlaySettlements: [],
    earnings: [],
    postmatchMessageIds,
  });
}
