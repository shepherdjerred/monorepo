import {
  type Ranks,
  type PlayerConfigEntry,
  type Rank,
  type RawSummonerLeague,
  type Region,
  parseDivision,
  TierSchema,
  RawSummonerLeagueSchema,
  LeaguePuuidSchema,
  regionToPlatformRoute,
} from "@scout-for-lol/data";
import { riotClient } from "#src/league/api/api.ts";
import { filter, first, pipe } from "remeda";
import { z } from "zod";
import { callRiotOrUndefined } from "#src/league/api/riot-call.ts";

const solo = "RANKED_SOLO_5x5";
const flex = "RANKED_FLEX_SR";
export type RankedQueueTypes = typeof solo | typeof flex;

function getRawEntry(
  entries: RawSummonerLeague[],
  queue: RankedQueueTypes,
): RawSummonerLeague | undefined {
  return pipe(
    entries,
    filter((entry: RawSummonerLeague) => entry.queueType === queue),
    first(),
  );
}

export type QueueRankEvaluation = {
  rank: Rank | undefined;
  status: "ranked" | "unplaced" | "unranked";
};

export function evaluateQueueRank(
  entries: RawSummonerLeague[],
  queue: RankedQueueTypes,
): QueueRankEvaluation {
  const entry = getRawEntry(entries, queue);
  if (entry === undefined) {
    return { rank: undefined, status: "unranked" };
  }

  if (
    entry.tier === undefined ||
    entry.rank === undefined ||
    entry.leaguePoints === undefined ||
    entry.wins === undefined ||
    entry.losses === undefined
  ) {
    return { rank: undefined, status: "unplaced" };
  }

  const division = parseDivision(entry.rank);
  if (division === undefined) {
    return { rank: undefined, status: "unplaced" };
  }

  const tierParse = TierSchema.safeParse(entry.tier.toLowerCase());
  if (!tierParse.success) {
    return { rank: undefined, status: "unplaced" };
  }

  const rank: Rank = {
    division,
    tier: tierParse.data,
    lp: entry.leaguePoints,
    wins: entry.wins,
    losses: entry.losses,
  };

  if (entry.provisional === true) {
    return { rank, status: "unplaced" };
  }

  const totalGames = rank.wins + rank.losses;
  if (totalGames < 5 && (totalGames === 0 || rank.lp === 0)) {
    return { rank, status: "unplaced" };
  }

  return { rank, status: "ranked" };
}

export function getRank(
  entries: RawSummonerLeague[],
  queue: RankedQueueTypes,
): Rank | undefined {
  return evaluateQueueRank(entries, queue).rank;
}

/**
 * Fetch ranks (solo + flex) for any player by PUUID and region.
 * Used by the loading screen to display ranks for all participants.
 * Returns error statuses when Riot API calls fail.
 */
export async function getRankByPuuid(
  puuid: string,
  region: Region,
): Promise<Ranks> {
  const platform = regionToPlatformRoute(region);
  const parsedPuuid = LeaguePuuidSchema.parse(puuid);
  const entries = await callRiotOrUndefined(
    {
      source: "rank-by-puuid",
      schema: z.array(RawSummonerLeagueSchema),
      schemaLabel: "summoner-league",
      context: { puuid, region },
    },
    () => riotClient.league.byPuuid(parsedPuuid, platform),
  );
  if (entries === undefined) {
    return {
      solo: undefined,
      flex: undefined,
      soloStatus: "error",
      flexStatus: "error",
    };
  }

  const soloEval = evaluateQueueRank(entries, solo);
  const flexEval = evaluateQueueRank(entries, flex);

  return {
    solo: soloEval.rank,
    flex: flexEval.rank,
    soloStatus: soloEval.status,
    flexStatus: flexEval.status,
  };
}

export async function getRanks(player: PlayerConfigEntry): Promise<Ranks> {
  const platform = regionToPlatformRoute(player.league.leagueAccount.region);
  const entries = await callRiotOrUndefined(
    {
      source: "rank",
      schema: z.array(RawSummonerLeagueSchema),
      schemaLabel: "summoner-league",
      context: {
        alias: player.alias,
        region: player.league.leagueAccount.region,
      },
    },
    () =>
      riotClient.league.byPuuid(
        player.league.leagueAccount.puuid,
        platform,
      ),
  );
  if (entries === undefined) {
    return {
      solo: undefined,
      flex: undefined,
      soloStatus: "error",
      flexStatus: "error",
    };
  }

  const soloEval = evaluateQueueRank(entries, solo);
  const flexEval = evaluateQueueRank(entries, flex);

  return {
    solo: soloEval.rank,
    flex: flexEval.rank,
    soloStatus: soloEval.status,
    flexStatus: flexEval.status,
  };
}
