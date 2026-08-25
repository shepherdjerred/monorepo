import { z } from "zod";
import {
  LeaguePuuidSchema,
  MatchIdSchema,
  RawMatchSchema,
  RawSummonerLeagueListSchema,
  type MatchId,
  type Rank,
  type RawMatch,
  type Region,
  type Ranks,
  isCustomMatchPayload,
  missingExpectedMatchFields,
  platformToRegionalRoute,
  regionToPlatformRoute,
} from "@scout-for-lol/data";
import { riotClient } from "#src/league/api/api.ts";
import { extractHttpStatus } from "#src/league/api/client/errors.ts";
import { callRiotOrThrow } from "#src/league/api/riot-call.ts";
import { getRank } from "#src/league/model/rank.ts";
import { saveFailedPayloadToS3 } from "#src/storage/s3-helpers.ts";
import { PermanentImportError } from "#src/league/initial-history/errors.ts";

export const INITIAL_HISTORY_MATCH_COUNT = 20;

export async function fetchInitialMatchIds(input: {
  puuid: string;
  region: Region;
}): Promise<MatchId[]> {
  const puuid = LeaguePuuidSchema.parse(input.puuid);
  return await callRiotOrThrow(
    {
      source: "initial-history-list",
      schema: z.array(MatchIdSchema).max(INITIAL_HISTORY_MATCH_COUNT),
      context: { region: input.region },
      sentry: true,
    },
    () =>
      riotClient.match.list(
        puuid,
        platformToRegionalRoute(input.region),
        {
          count: INITIAL_HISTORY_MATCH_COUNT,
        },
        { maxRetries: 0 },
      ),
  );
}

export async function fetchInitialMatch(input: {
  matchId: MatchId;
  region: Region;
}): Promise<RawMatch | null> {
  let match: RawMatch;
  try {
    match = await callRiotOrThrow(
      {
        source: "initial-history-match",
        schema: RawMatchSchema,
        schemaLabel: "match",
        context: { matchId: input.matchId, region: input.region },
        onValidationFailure: {
          kind: "save-to-s3",
          assetType: "match",
          id: input.matchId,
        },
        sentry: true,
      },
      () =>
        riotClient.match.get(
          input.matchId,
          platformToRegionalRoute(input.region),
          { maxRetries: 0 },
        ),
    );
  } catch (error) {
    if (extractHttpStatus(error) === 404) return null;
    throw error;
  }

  const missing = missingExpectedMatchFields(match);
  if (missing.length === 0 || isCustomMatchPayload(match)) return match;

  await saveFailedPayloadToS3({
    matchId: input.matchId,
    assetType: "match",
    rawPayload: match,
    validationError: {
      issues: missing.map((path) => ({
        path: path.split("."),
        message: "Required field absent from a matchmade payload",
        code: "invalid_type",
      })),
    },
  });
  throw new PermanentImportError(
    "contract",
    `Imported match ${input.matchId} is missing required matchmade fields: ${missing.join(", ")}`,
  );
}

function rankOrUndefined(
  entries: Parameters<typeof getRank>[0],
  queue: Parameters<typeof getRank>[1],
): Rank | undefined {
  return getRank(entries, queue);
}

export async function fetchCurrentRanks(input: {
  puuid: string;
  region: Region;
}): Promise<Ranks> {
  const puuid = LeaguePuuidSchema.parse(input.puuid);
  const entries = await callRiotOrThrow(
    {
      source: "initial-history-rank",
      schema: RawSummonerLeagueListSchema,
      schemaLabel: "summoner-league",
      context: { region: input.region },
      sentry: true,
    },
    () =>
      riotClient.league.byPuuid(puuid, regionToPlatformRoute(input.region), {
        maxRetries: 0,
      }),
  );
  return {
    solo: rankOrUndefined(entries, "RANKED_SOLO_5x5"),
    flex: rankOrUndefined(entries, "RANKED_FLEX_SR"),
    ranked5s: rankOrUndefined(entries, "RANKED_TEAM_5x5"),
  };
}
