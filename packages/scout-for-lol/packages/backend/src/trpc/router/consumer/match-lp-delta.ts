import {
  leaguePointsDelta,
  RankSchema,
  type Rank,
  type RankedQueueType,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { prisma } from "#src/database/index.ts";

/**
 * A tracked participant's rank change from one ranked game, as `MatchRankHistory`
 * captured it. `delta` is `null` where the two snapshots do not state a
 * difference: no rank before (placements) or a move across the Master line,
 * whose division arithmetic Riot does not publish.
 */
export type MatchLpDelta = {
  queueType: RankedQueueType;
  delta: number | null;
  rankBefore: Rank | null;
  rankAfter: Rank;
};

const APEX_TIERS = new Set(["master", "grandmaster", "challenger"]);

/** The ranked queue a Riot queue id is scored in; `null` for any other queue. */
export function rankedQueueTypeForQueueId(
  queueId: number,
): RankedQueueType | null {
  if (queueId === 420) return "solo";
  return queueId === 440 ? "flex" : null;
}

function parseSnapshot(json: string | null): Rank | null {
  return json === null || json.length === 0
    ? null
    : RankSchema.parse(JSON.parse(json));
}

function lpDeltaBetween(before: Rank | null, after: Rank): number | null {
  if (before === null) return null;
  const crossesApex =
    before.tier !== after.tier &&
    (APEX_TIERS.has(before.tier) || APEX_TIERS.has(after.tier));
  return crossesApex ? null : leaguePointsDelta(before, after);
}

/**
 * LP changes for the given accounts in one game, keyed by PUUID. A PUUID is
 * absent when no ranked snapshot was captured for this game and queue, when the
 * game was a remake, or when the queue is not ranked: never estimated.
 */
export async function loadMatchLpDeltas(options: {
  matchId: RiotMatchId;
  queueId: number;
  remake: boolean;
  puuids: readonly string[];
}): Promise<Map<string, MatchLpDelta>> {
  const result = new Map<string, MatchLpDelta>();
  const queueType = rankedQueueTypeForQueueId(options.queueId);
  if (queueType === null || options.remake || options.puuids.length === 0) {
    return result;
  }
  const records = await prisma.matchRankHistory.findMany({
    where: {
      matchId: options.matchId,
      queueType,
      puuid: { in: [...options.puuids] },
    },
    select: { puuid: true, rankBefore: true, rankAfter: true },
  });
  for (const record of records) {
    const rankAfter = parseSnapshot(record.rankAfter);
    if (rankAfter === null) continue;
    const rankBefore = parseSnapshot(record.rankBefore);
    result.set(record.puuid, {
      queueType,
      delta: lpDeltaBetween(rankBefore, rankAfter),
      rankBefore,
      rankAfter,
    });
  }
  return result;
}
