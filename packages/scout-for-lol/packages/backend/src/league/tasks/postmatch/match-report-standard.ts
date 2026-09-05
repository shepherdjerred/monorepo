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

/** Timeline capture required by active challenge or duel evidence. */
export async function fetchTimelineForProgression(
  matchData: RawMatch,
  matchId: MatchId,
  playersInMatch: PlayerConfigEntry[],
): Promise<RawTimeline | undefined> {
  return await fetchAndRecordTimeline({
    matchData,
    matchId,
    playersInMatch,
    persistence: "required",
    source: "timeline_progression",
  });
}

/** Reassert durable persistence when an earlier best-effort report fetch supplied the timeline. */
export async function persistTimelineForProgression(
  timeline: RawTimeline,
  playersInMatch: PlayerConfigEntry[],
  matchId: MatchId,
): Promise<void> {
  const staged = await recordTimelineForReportStore({
    timeline,
    source: "timeline_progression",
    trackedPlayerAliases: playersInMatch.map((player) => player.alias),
  });
  requireTimelineStaging("required", staged, matchId);
}

async function fetchAndRecordTimeline(options: {
  matchData: RawMatch;
  matchId: MatchId;
  playersInMatch: PlayerConfigEntry[];
  persistence: "best_effort" | "required";
  source?: "timeline_progression";
}): Promise<RawTimeline | undefined> {
  // Don't fetch timeline for arena matches
  if (
    isArenaQueueOrMode(
      options.matchData.info.queueId,
      options.matchData.info.gameMode,
    )
  ) {
    requireTimelineStaging(options.persistence, false, options.matchId);
    return undefined;
  }

  const firstPlayer = options.playersInMatch[0];
  if (!firstPlayer) {
    requireTimelineStaging(options.persistence, false, options.matchId);
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
            options.source ??
            (options.persistence === "required"
              ? "timeline_dare_v2"
              : "timeline_live"),
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
    requireTimelineStaging(
      options.persistence,
      timelineData !== undefined,
      options.matchId,
    );
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
