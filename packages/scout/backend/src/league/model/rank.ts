import type { Ranks, PlayerConfigEntry, Rank, RawSummonerLeague } from "@shepherdjerred/scout-data";
import { parseDivision, TierSchema, RawSummonerLeagueSchema } from "@shepherdjerred/scout-data";
import { api } from "@shepherdjerred/scout-backend/league/api/api";
import { filter, first, pipe } from "remeda";
import { mapRegionToEnum } from "@shepherdjerred/scout-backend/league/model/region";
import { z } from "zod";
import { riotApiErrorsTotal } from "@shepherdjerred/scout-backend/metrics/index.ts";
import { createLogger } from "@shepherdjerred/scout-backend/logger.ts";
import { withTimeout } from "@shepherdjerred/scout-backend/utils/timeout.ts";

const logger = createLogger("model-rank");

const solo = "RANKED_SOLO_5x5";
const flex = "RANKED_FLEX_SR";
export type RankedQueueTypes = typeof solo | typeof flex;

function getRawEntry(entries: RawSummonerLeague[], queue: RankedQueueTypes): RawSummonerLeague | undefined {
  return pipe(
    entries,
    filter((entry: RawSummonerLeague) => entry.queueType === queue),
    first(),
  );
}

export function getRank(entries: RawSummonerLeague[], queue: RankedQueueTypes): Rank | undefined {
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

export async function getRanks(player: PlayerConfigEntry): Promise<Ranks> {
  try {
    const response = await withTimeout(
      api.League.byPUUID(player.league.leagueAccount.puuid, mapRegionToEnum(player.league.leagueAccount.region)),
    );

    const parseResult = z.array(RawSummonerLeagueSchema).safeParse(response.response);
    if (!parseResult.success) {
      throw parseResult.error;
    }
    const validatedResponse = parseResult.data;

    return {
      solo: getRank(validatedResponse, solo),
      flex: getRank(validatedResponse, flex),
    };
  } catch (error) {
    logger.error(`Failed to fetch ranks for ${player.alias}:`, error);
    riotApiErrorsTotal.inc({ source: "rank-fetch", http_status: "unknown" });
    throw error;
  }
}
