import {
  isArenaQueueOrMode,
  type PlayerConfigEntry,
  type MatchId,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data/index.ts";
import { fetchMatchTimeline } from "./match-data-fetcher.ts";
import { createLogger } from "#src/logger.ts";
import * as Sentry from "@sentry/bun";
import { recordTimelineForReportStore } from "#src/report-store/live-ingest.ts";

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
  if (isArenaQueueOrMode(matchData.info.queueId, matchData.info.gameMode)) {
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

      // Persist the timeline to S3 (canonical raw store; used later for
      // frontend AI review generation). Best-effort: a timeline failure must
      // not block the match report, so swallow it here rather than let it
      // propagate — timelines have no lake reader and the match itself was
      // already durably saved upstream.
      try {
        const trackedPlayerAliases = playersInMatch.map((p) => p.alias);
        await recordTimelineForReportStore({
          timeline: timelineData,
          source: "timeline_live",
          trackedPlayerAliases,
        });
      } catch (error) {
        logger.error(
          `[generateMatchReport] Error saving timeline ${matchId} to S3:`,
          error,
        );
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
