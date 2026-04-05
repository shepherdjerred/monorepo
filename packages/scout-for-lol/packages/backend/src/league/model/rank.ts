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
  riotApiErrorsTotal,
  riotApiRequestsTotal,
  updateRiotApiHealth,
} from "#src/metrics/index.ts";
import { createLogger } from "#src/logger.ts";
import { withTimeout } from "#src/utils/timeout.ts";

const logger = createLogger("model-rank");

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
 * Fetch solo queue rank for any player by PUUID and region.
 * Used by the loading screen to display ranks for all 10 participants.
 * Returns undefined on any error (graceful — does not throw).
 */
export async function getRankByPuuid(
  puuid: string,
  region: Region,
): Promise<Rank | undefined> {
  try {
    const response = await withTimeout(
      api.League.byPUUID(puuid, mapRegionToEnum(region)),
    );
    riotApiRequestsTotal.inc({
      source: "rank-by-puuid",
      status: "success",
    });
    updateRiotApiHealth(true);

    const parseResult = z
      .array(RawSummonerLeagueSchema)
      .safeParse(response.response);
    if (!parseResult.success) {
      logger.warn(
        `Failed to parse rank response for puuid ${puuid}:`,
        parseResult.error,
      );
      return undefined;
    }

    return getRank(parseResult.data, solo);
  } catch (error) {
    const status =
      error instanceof Error && error.message.includes("timed out")
        ? "timeout"
        : "error";
    riotApiRequestsTotal.inc({ source: "rank-by-puuid", status });
    // Don't log at error level — rank fetch failures for non-tracked players are expected
    logger.debug(`Failed to fetch rank for puuid ${puuid}: ${String(error)}`);
    return undefined;
  }
}

export async function getRanks(player: PlayerConfigEntry): Promise<Ranks> {
  try {
    const response = await withTimeout(
      api.League.byPUUID(
        player.league.leagueAccount.puuid,
        mapRegionToEnum(player.league.leagueAccount.region),
      ),
    );
    riotApiRequestsTotal.inc({ source: "rank", status: "success" });
    updateRiotApiHealth(true);

    const parseResult = z
      .array(RawSummonerLeagueSchema)
      .safeParse(response.response);
    if (!parseResult.success) {
      throw parseResult.error;
    }
    const validatedResponse = parseResult.data;

    return {
      solo: getRank(validatedResponse, solo),
      flex: getRank(validatedResponse, flex),
    };
  } catch (error) {
    riotApiRequestsTotal.inc({
      source: "rank",
      status:
        error instanceof Error && error.message.includes("timed out")
          ? "timeout"
          : "error",
    });
    updateRiotApiHealth(false);
    logger.error(`Failed to fetch ranks for ${player.alias}:`, error);
    riotApiErrorsTotal.inc({ source: "rank-fetch", http_status: "unknown" });
    throw error;
  }
}
