import { api } from "#src/league/api/api.ts";
import { regionToRegionGroup } from "twisted/dist/constants/regions.js";
import { mapRegionToEnum } from "#src/league/model/region.ts";
import type {
  Region,
  MatchId,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data/index.ts";
import {
  RawMatchSchema,
  RawTimelineSchema,
} from "@scout-for-lol/data/index.ts";
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
  const region = mapRegionToEnum(playerRegion);
  const regionGroup = regionToRegionGroup(region);

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
    () => api.MatchV5.get(matchId, regionGroup),
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
  const region = mapRegionToEnum(playerRegion);
  const regionGroup = regionToRegionGroup(region);

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
    () => api.MatchV5.timeline(matchId, regionGroup),
  );
}
