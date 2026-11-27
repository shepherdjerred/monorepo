import type { LeaguePuuid, Ranks, Region } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { extractHttpStatus } from "#src/league/api/client/errors.ts";
import type { RiotPriority } from "#src/league/api/client/rate-budget.ts";
import { upsertCurrentRankSnapshot } from "./current-rank-snapshot.ts";
import {
  RANK_REFRESH_BATCH_SIZE,
  selectDueRankPlayers,
} from "./due-players.ts";

/**
 * Riot class of every rank-refresh call: below live and interactive traffic,
 * above the crawl, so the refresh can never delay a match notification or a
 * page's own lookup.
 */
export const RANK_REFRESH_PRIORITY: RiotPriority = "backfill";

export type RankRefreshDependencies = {
  prisma: ExtendedPrismaClient;
  /** The existing league-entry fetch (`fetchCurrentRanks`). */
  fetchRanks: (input: {
    priority: RiotPriority;
    puuid: LeaguePuuid;
    region: Region;
  }) => Promise<Ranks>;
  now: () => Date;
  /** Called before each player, so the Activity beats while a Riot call waits its turn. */
  onProgress: (progress: { done: number; of: number }) => void;
  batchSize?: number;
};

export type RankRefreshBatch = {
  refreshed: number;
  unranked: number;
  /** The batch was full, so more players may be due. */
  more: boolean;
};

const UNRANKED: Ranks = {
  solo: undefined,
  flex: undefined,
  ranked5s: undefined,
};

function isUnranked(ranks: Ranks): boolean {
  return (
    ranks.solo === undefined &&
    ranks.flex === undefined &&
    ranks.ranked5s === undefined
  );
}

/**
 * Refreshes one bounded batch of due players, one at a time, writing each
 * player's snapshot as soon as Riot answers.
 *
 * Idempotent by construction: a written snapshot takes its player out of the
 * due set, so an Activity retried after a failure re-selects only the players
 * the failed attempt did not reach, and a second run the same day selects
 * nobody it already covered.
 *
 * Riot's 404 for a league lookup means the player has no ranked entries and is
 * recorded as unranked. Every other failure propagates to the Activity's retry
 * policy; the players written before it stay written.
 */
export async function refreshDueRanks(
  dependencies: RankRefreshDependencies,
): Promise<RankRefreshBatch> {
  const limit = dependencies.batchSize ?? RANK_REFRESH_BATCH_SIZE;
  const due = await selectDueRankPlayers(dependencies.prisma, {
    now: dependencies.now(),
    limit,
  });
  let refreshed = 0;
  let unranked = 0;
  for (const player of due) {
    dependencies.onProgress({ done: refreshed + unranked, of: due.length });
    const ranks = await fetchRanksOrUnranked(dependencies, player);
    await upsertCurrentRankSnapshot(dependencies.prisma, {
      puuid: player.puuid,
      ranks,
      fetchedAt: dependencies.now(),
    });
    if (isUnranked(ranks)) unranked += 1;
    else refreshed += 1;
  }
  return { refreshed, unranked, more: due.length === limit };
}

async function fetchRanksOrUnranked(
  dependencies: RankRefreshDependencies,
  player: { puuid: LeaguePuuid; region: Region },
): Promise<Ranks> {
  try {
    return await dependencies.fetchRanks({
      priority: RANK_REFRESH_PRIORITY,
      puuid: player.puuid,
      region: player.region,
    });
  } catch (error) {
    if (extractHttpStatus(error) === 404) return UNRANKED;
    throw error;
  }
}
