import { z, ZodError } from "zod";
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
import { createLogger } from "#src/logger.ts";
import {
  riotApiErrorsTotal,
  riotApiRequestsTotal,
  updateRiotApiHealth,
} from "#src/metrics/index.ts";
import { saveFailedPayloadToS3 } from "#src/storage/s3-helpers.ts";
import { withTimeout } from "#src/utils/timeout.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("match-data-fetcher");

function trackApiError(source: string, httpStatus: string): void {
  riotApiErrorsTotal.inc({ source, http_status: httpStatus });
}

/**
 * Fetch match data from Riot API
 *
 * Validates the response against our schema to ensure type safety and catch API changes.
 */
export async function fetchMatchData(
  matchId: MatchId,
  playerRegion: Region,
): Promise<RawMatch | undefined> {
  try {
    const region = mapRegionToEnum(playerRegion);
    const regionGroup = regionToRegionGroup(region);

    Sentry.addBreadcrumb({
      category: "riot-api",
      message: `Fetching match data for ${matchId}`,
      data: { matchId, region: playerRegion, endpoint: "MatchV5.get" },
      level: "info",
    });

    logger.info(`[fetchMatchData] 📥 Fetching match data for ${matchId}`);
    const response = await withTimeout(api.MatchV5.get(matchId, regionGroup));
    riotApiRequestsTotal.inc({ source: "match-data", status: "success" });
    updateRiotApiHealth(true);

    // Validate and parse the API response to ensure it matches our schema
    try {
      const validated = RawMatchSchema.parse(response.response);
      return validated;
    } catch (parseError) {
      logger.error(
        `[fetchMatchData] ❌ Match data validation failed for ${matchId}:`,
        parseError,
      );
      logger.error(
        `[fetchMatchData] This may indicate an API schema change or data corruption`,
      );
      trackApiError("match-data-validation", "validation");

      // Save failed payload to S3 for debugging
      if (parseError instanceof ZodError) {
        await saveFailedPayloadToS3({
          matchId,
          assetType: "match",
          rawPayload: response.response,
          validationError: parseError,
        });
      }

      return undefined;
    }
  } catch (error) {
    riotApiRequestsTotal.inc({
      source: "match-data",
      status:
        error instanceof Error && error.message.includes("timed out")
          ? "timeout"
          : "error",
    });
    updateRiotApiHealth(false);

    const result = z.object({ status: z.number() }).safeParse(error);
    if (result.success) {
      const status = result.data.status;
      if (status === 404) {
        logger.info(
          `[fetchMatchData] ℹ️  Match ${matchId} not found (404) - may still be processing`,
        );
        return undefined;
      }
      logger.error(
        `[fetchMatchData] ❌ HTTP Error ${status.toString()} for match ${matchId}`,
      );
      trackApiError("match-data-fetch", status.toString());
      Sentry.captureException(error, {
        tags: {
          source: "match-data-fetch",
          matchId,
          region: playerRegion,
          httpStatus: status.toString(),
        },
      });
    } else {
      logger.error(
        `[fetchMatchData] ❌ Error fetching match ${matchId}:`,
        error,
      );
      trackApiError("match-data-fetch", "unknown");
    }
    return undefined;
  }
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
  try {
    const region = mapRegionToEnum(playerRegion);
    const regionGroup = regionToRegionGroup(region);

    Sentry.addBreadcrumb({
      category: "riot-api",
      message: `Fetching timeline data for ${matchId}`,
      data: { matchId, region: playerRegion, endpoint: "MatchV5.timeline" },
      level: "info",
    });

    logger.info(
      `[fetchMatchTimeline] 📥 Fetching timeline data for ${matchId}`,
    );

    // Use the timeline endpoint from the twisted library
    // The twisted library provides api.MatchV5.timeline() for Match V5 Timeline API
    const response = await withTimeout(
      api.MatchV5.timeline(matchId, regionGroup),
    );
    riotApiRequestsTotal.inc({ source: "match-timeline", status: "success" });
    updateRiotApiHealth(true);

    // Validate and parse the API response to ensure it matches our schema
    try {
      const validated = RawTimelineSchema.parse(response.response);
      logger.info(
        `[fetchMatchTimeline] ✅ Timeline validated with ${validated.info.frames.length.toString()} frames`,
      );
      return validated;
    } catch (parseError) {
      logger.error(
        `[fetchMatchTimeline] ❌ Timeline data validation failed for ${matchId}:`,
        parseError,
      );
      logger.error(
        `[fetchMatchTimeline] This may indicate an API schema change or data corruption`,
      );
      trackApiError("timeline-data-validation", "validation");

      // Save failed payload to S3 for debugging
      if (parseError instanceof ZodError) {
        await saveFailedPayloadToS3({
          matchId,
          assetType: "timeline",
          rawPayload: response.response,
          validationError: parseError,
        });
      }

      return undefined;
    }
  } catch (error) {
    riotApiRequestsTotal.inc({
      source: "match-timeline",
      status:
        error instanceof Error && error.message.includes("timed out")
          ? "timeout"
          : "error",
    });
    updateRiotApiHealth(false);

    const result = z.object({ status: z.number() }).safeParse(error);
    if (result.success) {
      const status = result.data.status;
      if (status === 404) {
        logger.info(
          `[fetchMatchTimeline] ℹ️  Timeline ${matchId} not found (404) - may still be processing`,
        );
        return undefined;
      }
      logger.error(
        `[fetchMatchTimeline] ❌ HTTP Error ${status.toString()} for timeline ${matchId}`,
      );
      trackApiError("timeline-data-fetch", status.toString());
      Sentry.captureException(error, {
        tags: {
          source: "timeline-data-fetch",
          matchId,
          region: playerRegion,
          httpStatus: status.toString(),
        },
      });
    } else {
      logger.error(
        `[fetchMatchTimeline] ❌ Error fetching timeline ${matchId}:`,
        error,
      );
      trackApiError("timeline-data-fetch", "unknown");
    }
    return undefined;
  }
}
