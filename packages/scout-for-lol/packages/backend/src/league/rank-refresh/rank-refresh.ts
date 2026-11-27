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
  /** Players an earlier batch of this run found permanently rejected. */
  excluded: readonly LeaguePuuid[];
  batchSize?: number;
};

/** A player Riot rejected with a status that retrying cannot change. */
export type RankRefreshFailure = { puuid: LeaguePuuid; status: number };

export type RankRefreshBatch = {
  refreshed: number;
  unranked: number;
  /** Players Riot permanently rejected; none was written. */
  failed: RankRefreshFailure[];
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
 * A client error that asking again cannot change: any 4xx except 404 (handled
 * as unranked), 408 and 429 (the request or the budget, not the player).
 * Everything else that fails (5xx, transport, a deferred budget) is transient.
 */
function permanentRejection(error: unknown): number | undefined {
  const status = extractHttpStatus(error);
  if (status === undefined || status < 400 || status >= 500) return undefined;
  return status === 404 || status === 408 || status === 429
    ? undefined
    : status;
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
 * recorded as unranked. A permanent per-player rejection (see
 * {@link permanentRejection}) is reported in `failed` and the batch continues,
 * so one bad player cannot block the others; the Workflow excludes them for
 * the rest of the run and fails it at the end. Every transient failure
 * propagates at once to the Activity's retry policy, and the players written
 * before it stay written.
 */
export async function refreshDueRanks(
  dependencies: RankRefreshDependencies,
): Promise<RankRefreshBatch> {
  const limit = dependencies.batchSize ?? RANK_REFRESH_BATCH_SIZE;
  const due = await selectDueRankPlayers(dependencies.prisma, {
    now: dependencies.now(),
    limit,
    excluded: dependencies.excluded,
  });
  let refreshed = 0;
  let unranked = 0;
  const failed: RankRefreshFailure[] = [];
  for (const player of due) {
    dependencies.onProgress({
      done: refreshed + unranked + failed.length,
      of: due.length,
    });
    const outcome = await fetchRanksOrReject(dependencies, player);
    if (outcome.kind === "rejected") {
      failed.push({ puuid: player.puuid, status: outcome.status });
      continue;
    }
    await upsertCurrentRankSnapshot(dependencies.prisma, {
      puuid: player.puuid,
      ranks: outcome.ranks,
      fetchedAt: dependencies.now(),
    });
    if (isUnranked(outcome.ranks)) unranked += 1;
    else refreshed += 1;
  }
  return { refreshed, unranked, failed, more: due.length === limit };
}

type FetchOutcome =
  { kind: "ranks"; ranks: Ranks } | { kind: "rejected"; status: number };

async function fetchRanksOrReject(
  dependencies: RankRefreshDependencies,
  player: { puuid: LeaguePuuid; region: Region },
): Promise<FetchOutcome> {
  try {
    const ranks = await dependencies.fetchRanks({
      priority: RANK_REFRESH_PRIORITY,
      puuid: player.puuid,
      region: player.region,
    });
    return { kind: "ranks", ranks };
  } catch (error) {
    if (extractHttpStatus(error) === 404) {
      return { kind: "ranks", ranks: UNRANKED };
    }
    const status = permanentRejection(error);
    if (status === undefined) throw error;
    return { kind: "rejected", status };
  }
}
