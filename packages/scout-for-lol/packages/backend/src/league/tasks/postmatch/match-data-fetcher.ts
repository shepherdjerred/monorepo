import { riotClient } from "#src/league/api/api.ts";
import {
  type Region,
  type MatchId,
  type RawMatch,
  type RawTimeline,
  RawMatchSchema,
  RawTimelineSchema,
  platformToRegionalRoute,
  isCustomMatchPayload,
  missingExpectedMatchFields,
} from "@scout-for-lol/data";
import { callRiotOrUndefined } from "#src/league/api/riot-call.ts";
import { createLogger } from "#src/logger.ts";
import { riotApiErrorsTotal } from "#src/metrics/index.ts";
import { riotCustomMatchMissingFieldsTotal } from "#src/metrics/index.ts";
import { saveFailedPayloadToS3 } from "#src/storage/s3-helpers.ts";

const logger = createLogger("match-data-fetcher");

/**
 * Fetch match data from Riot API
 *
 * Validates the response against our schema to ensure type safety and catch API changes.
 */
export async function fetchMatchData(
  matchId: MatchId,
  playerRegion: Region,
): Promise<RawMatch | undefined> {
  const regionalRoute = platformToRegionalRoute(playerRegion);

  const match = await callRiotOrUndefined(
    {
      source: "match-data",
      schema: RawMatchSchema,
      schemaLabel: "match",
      context: { matchId, region: playerRegion },
      onValidationFailure: {
        kind: "save-to-s3",
        assetType: "match",
        id: matchId,
      },
      sentry: true,
    },
    () => riotClient.match.get(matchId, regionalRoute),
  );
  if (match === undefined) {
    return undefined;
  }

  const missing = missingExpectedMatchFields(match);
  if (missing.length === 0) {
    return match;
  }

  if (isCustomMatchPayload(match)) {
    // Tolerated: Riot omits mission progress, ranked progression, and the
    // tournament code for lobbies that have no such concept. Counted so the
    // tolerance is measurable rather than invisible.
    logger.warn(
      `[match-data] ⚠️ Custom game ${matchId} omits ${missing.join(", ")}; proceeding`,
    );
    for (const field of missing) {
      riotCustomMatchMissingFieldsTotal.inc({ field });
    }
    return match;
  }

  // A matchmade payload missing these is a genuine problem, and gets exactly
  // the treatment it got before the fields became optional: logged, counted as
  // a validation failure, persisted for debugging, and skipped. Making the
  // fields optional must not weaken matchmade games by one bit.
  logger.error(
    `[match-data] ❌ Matchmade game ${matchId} is missing ${missing.join(", ")}`,
  );
  riotApiErrorsTotal.inc({ source: "match-data", http_status: "validation" });
  await saveFailedPayloadToS3({
    matchId,
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
  return undefined;
}

/**
 * Fetch match timeline data from Riot API
 *
 * The timeline provides frame-by-frame game data including:
 * - Participant stats evolution (gold, XP, position)
 * - Game events (kills, item purchases, objectives, etc.)
 *
 * Validates the response against our schema to ensure type safety and catch API changes.
 */
export async function fetchMatchTimeline(
  matchId: MatchId,
  playerRegion: Region,
): Promise<RawTimeline | undefined> {
  const regionalRoute = platformToRegionalRoute(playerRegion);

  return callRiotOrUndefined(
    {
      source: "match-timeline",
      schema: RawTimelineSchema,
      schemaLabel: "timeline",
      context: { matchId, region: playerRegion },
      onValidationFailure: {
        kind: "save-to-s3",
        assetType: "timeline",
        id: matchId,
      },
      sentry: true,
    },
    () => riotClient.match.timeline(matchId, regionalRoute),
  );
}
