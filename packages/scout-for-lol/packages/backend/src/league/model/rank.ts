import {
  type LoadingScreenRankState,
  type PlayerConfigEntry,
  type Rank,
  type Ranks,
  type RawSummonerLeague,
  type Region,
  type StandardRankedQueueType,
  LeaguePuuidSchema,
  RawSummonerLeagueListSchema,
  StandardSummonerLeagueSchema,
  TierSchema,
  parseDivision,
  regionToPlatformRoute,
} from "@scout-for-lol/data";
import { riotClient } from "#src/league/api/api.ts";
import { callRiotOrUndefined } from "#src/league/api/riot-call.ts";

const solo: StandardRankedQueueType = "RANKED_SOLO_5x5";
const flex: StandardRankedQueueType = "RANKED_FLEX_SR";

export type RankLookupResult = Exclude<
  LoadingScreenRankState,
  { status: "hidden" }
>;

function getRawEntry(
  entries: readonly RawSummonerLeague[],
  queue: StandardRankedQueueType,
): RawSummonerLeague | undefined {
  return entries.find((entry) => entry.queueType === queue);
}

export function getRank(
  entries: readonly RawSummonerLeague[],
  queue: StandardRankedQueueType,
): Rank | undefined {
  const rawEntry = getRawEntry(entries, queue);
  if (rawEntry === undefined) {
    return undefined;
  }

  const entry = StandardSummonerLeagueSchema.parse(rawEntry);
  const division = parseDivision(entry.rank);
  if (division === undefined) {
    throw new Error(
      `Validated League-V4 division ${entry.rank} is unsupported`,
    );
  }

  return {
    division,
    tier: TierSchema.parse(entry.tier.toLowerCase()),
    lp: entry.leaguePoints,
    wins: entry.wins,
    losses: entry.losses,
  };
}

function ranksFromEntries(entries: readonly RawSummonerLeague[]): Ranks {
  return {
    solo: getRank(entries, solo),
    flex: getRank(entries, flex),
  };
}

async function fetchRanksByPuuid(input: {
  puuid: string;
  region: Region;
  source: "rank" | "rank-by-puuid";
  context: Record<string, string>;
}): Promise<RankLookupResult> {
  const platform = regionToPlatformRoute(input.region);
  const parsedPuuid = LeaguePuuidSchema.parse(input.puuid);
  const entries = await callRiotOrUndefined(
    {
      source: input.source,
      schema: RawSummonerLeagueListSchema,
      schemaLabel: "summoner-league",
      context: input.context,
    },
    () => riotClient.league.byPuuid(parsedPuuid, platform),
  );

  return entries === undefined
    ? { status: "error" }
    : { status: "available", ranks: ranksFromEntries(entries) };
}

/** Fetch the published Solo/Duo and Flex ranks for a loading-screen player. */
export async function getRankByPuuid(
  puuid: string,
  region: Region,
): Promise<RankLookupResult> {
  return fetchRanksByPuuid({
    puuid,
    region,
    source: "rank-by-puuid",
    context: { puuid, region },
  });
}

/** Preserve the persisted player-rank shape for non-loading-screen consumers. */
export async function getRanks(player: PlayerConfigEntry): Promise<Ranks> {
  const result = await fetchRanksByPuuid({
    puuid: player.league.leagueAccount.puuid,
    region: player.league.leagueAccount.region,
    source: "rank",
    context: {
      alias: player.alias,
      region: player.league.leagueAccount.region,
    },
  });

  return result.status === "available"
    ? result.ranks
    : { solo: undefined, flex: undefined };
}
