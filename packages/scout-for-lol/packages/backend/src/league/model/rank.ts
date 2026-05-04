import type {
  Ranks,
  PlayerConfigEntry,
  Rank,
  RawSummonerLeague,
  Region,
} from "@scout-for-lol/data";
import {
  parseDivision,
  TierSchema,
  RawSummonerLeagueSchema,
} from "@scout-for-lol/data";
import { api } from "#src/league/api/api.ts";
import { filter, first, pipe } from "remeda";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import { z } from "zod";
import {
  callRiotOrThrow,
  callRiotOrUndefined,
} from "#src/league/api/riot-call.ts";

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

export function getRank(
  entries: RawSummonerLeague[],
  queue: RankedQueueTypes,
): Rank | undefined {
  const entry = getRawEntry(entries, queue);
  if (entry == undefined) {
    return undefined;
  }

  const division = parseDivision(entry.rank);
  if (division == undefined) {
    return undefined;
  }

  return {
    division,
    tier: TierSchema.parse(entry.tier.toLowerCase()),
    lp: entry.leaguePoints,
    wins: entry.wins,
    losses: entry.losses,
  };
}

/**
 * Fetch ranks (solo + flex) for any player by PUUID and region.
 * Used by the loading screen to display ranks for all participants.
 * Returns undefined on any error (graceful — does not throw).
 */
export async function getRankByPuuid(
  puuid: string,
  region: Region,
): Promise<Ranks | undefined> {
  const entries = await callRiotOrUndefined(
    {
      source: "rank-by-puuid",
      schema: z.array(RawSummonerLeagueSchema),
      schemaLabel: "summoner-league",
      context: { puuid, region },
    },
    () => api.League.byPUUID(puuid, mapRegionToEnum(region)),
  );
  if (entries === undefined) return undefined;
  return {
    solo: getRank(entries, solo),
    flex: getRank(entries, flex),
  };
}

export async function getRanks(player: PlayerConfigEntry): Promise<Ranks> {
  const entries = await callRiotOrThrow(
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
      api.League.byPUUID(
        player.league.leagueAccount.puuid,
        mapRegionToEnum(player.league.leagueAccount.region),
      ),
  );
  return {
    solo: getRank(entries, solo),
    flex: getRank(entries, flex),
  };
}
