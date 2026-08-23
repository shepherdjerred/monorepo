import { riotClient } from "#src/league/api/api.ts";
import {
  type Region,
  type MatchId,
  type RawMatch,
  type RawTimeline,
  RawMatchSchema,
  RawTimelineSchema,
  platformToRegionalRoute,
} from "@scout-for-lol/data";
import { callRiotOrUndefined } from "#src/league/api/riot-call.ts";

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

  return callRiotOrUndefined(
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
