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

function requireTimelineStaging(
  persistence: "best_effort" | "required",
  staged: boolean,
  matchId: MatchId,
): void {
  if (staged || persistence !== "required") return;
  throw new Error(
    `Timeline lake staging failed for ${matchId}; match processing must retry.`,
  );
}

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
  return await fetchAndRecordTimeline({
    matchData,
    matchId,
    playersInMatch,
    persistence: "best_effort",
  });
}

/** Timeline capture required by a funded contract; persistence failure retries the match. */
export async function fetchTimelineForDareV2(
  matchData: RawMatch,
  matchId: MatchId,
  playersInMatch: PlayerConfigEntry[],
): Promise<RawTimeline | undefined> {
  return await fetchAndRecordTimeline({
    matchData,
    matchId,
    playersInMatch,
    persistence: "required",
  });
}

async function fetchAndRecordTimeline(options: {
  matchData: RawMatch;
  matchId: MatchId;
  playersInMatch: PlayerConfigEntry[];
  persistence: "best_effort" | "required";
}): Promise<RawTimeline | undefined> {
  // Don't fetch timeline for arena matches
  if (
    isArenaQueueOrMode(
      options.matchData.info.queueId,
      options.matchData.info.gameMode,
    )
  ) {
    return undefined;
  }

  const firstPlayer = options.playersInMatch[0];
  if (!firstPlayer) {
    return undefined;
  }

  const playerRegion = firstPlayer.league.leagueAccount.region;
  try {
    logger.info(
      `[generateMatchReport] 📊 Fetching timeline data for match ${options.matchId}`,
    );
    const timelineData = await fetchMatchTimeline(
      options.matchId,
      playerRegion,
      options.persistence === "required" ? "throw" : "return_undefined",
    );
    if (timelineData) {
      logger.info(
        `[generateMatchReport] ✅ Timeline fetched with ${timelineData.info.frames.length.toString()} frames`,
      );

      // A funded Dare makes this write authoritative evidence and therefore
      // retryable. Report-only capture remains best-effort because the match
      // itself was already durably saved upstream.
      try {
        const trackedPlayerAliases = options.playersInMatch.map(
          (player) => player.alias,
        );
        const staged = await recordTimelineForReportStore({
          timeline: timelineData,
          source:
            options.persistence === "required"
              ? "timeline_dare_v2"
              : "timeline_live",
          trackedPlayerAliases,
        });
        requireTimelineStaging(options.persistence, staged, options.matchId);
      } catch (error) {
        if (options.persistence === "required") throw error;
        logger.error(
          `[generateMatchReport] Error saving timeline ${options.matchId} to S3:`,
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
      tags: { source: "timeline-fetch-wrapper", matchId: options.matchId },
    });
    if (options.persistence === "required") throw error;
    return undefined;
  }
}
