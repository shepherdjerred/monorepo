import type {
  PlayerConfigEntry,
  MatchId,
  RawMatch,
  RawTimeline,
} from "@scout-for-lol/data/index.ts";
import { saveTimelineToS3 } from "@scout-for-lol/backend/storage/s3.ts";
import { fetchMatchTimeline } from "./match-data-fetcher.ts";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import * as Sentry from "@sentry/bun";

const logger = createLogger("postmatch-match-report-standard");

/**
 * Fetch timeline data for standard (non-arena) matches
 * Returns undefined for arena matches or if timeline fetch fails
 * Also saves the timeline to S3 for later use (e.g., frontend AI review generation)
 */
export async function fetchTimelineIfStandardMatch(
  matchData: RawMatch,
  matchId: MatchId,
  playersInMatch: PlayerConfigEntry[],
): Promise<RawTimeline | undefined> {
  // Don't fetch timeline for arena matches
  if (matchData.info.queueId === 1700) {
    return undefined;
  }

  const firstPlayer = playersInMatch[0];
  if (!firstPlayer) {
    return undefined;
  }

  const playerRegion = firstPlayer.league.leagueAccount.region;
  try {
    logger.info(
      `[generateMatchReport] 📊 Fetching timeline data for match ${matchId}`,
    );
    const timelineData = await fetchMatchTimeline(matchId, playerRegion);
    if (timelineData) {
      logger.info(
        `[generateMatchReport] ✅ Timeline fetched with ${timelineData.info.frames.length.toString()} frames`,
      );

      // Save timeline to S3 for later use (e.g., frontend AI review generation)
      try {
        const trackedPlayerAliases = playersInMatch.map((p) => p.alias);
        await saveTimelineToS3(timelineData, trackedPlayerAliases);
      } catch (error) {
        logger.error(
          `[generateMatchReport] Error saving timeline ${matchId} to S3:`,
          error,
        );
        // Continue processing even if S3 storage fails
      }
    }
    return timelineData;
  } catch (error) {
    logger.error(
      `[generateMatchReport] ⚠️  Failed to fetch timeline, continuing without it:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "timeline-fetch-wrapper", matchId },
    });
    return undefined;
  }
}
