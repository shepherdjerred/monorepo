import {
  isArenaQueueOrMode,
  type PlayerConfigEntry,
  type RiotMatchId,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data/index.ts";
import { fetchMatchTimeline } from "./match-data-fetcher.ts";
import { createLogger } from "#src/logger.ts";
import * as Sentry from "@sentry/bun";
import { recordTimelineForReportStore } from "#src/report-store/live-ingest.ts";
import {
  readTimelineSelection,
  readFrozenTimeline,
} from "#src/scout-client/canonical-match.ts";

const logger = createLogger("postmatch-match-report-standard");

type TimelinePersistence = "best_effort" | "required" | "required_if_available";

function requireTimelineStaging(
  persistence: TimelinePersistence,
  staged: boolean,
  matchId: RiotMatchId,
): void {
  if (staged || persistence === "best_effort") return;
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
  matchId: RiotMatchId,
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
export async function fetchTimelineForDare(
  matchData: RawMatch,
  matchId: RiotMatchId,
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
  matchId: RiotMatchId,
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

/** Duel evidence is durable when Riot supplies it; missing evidence enters organizer review. */
export async function fetchTimelineForDuelProgression(
  matchData: RawMatch,
  matchId: RiotMatchId,
  playersInMatch: PlayerConfigEntry[],
): Promise<RawTimeline | undefined> {
  return await fetchAndRecordTimeline({
    matchData,
    matchId,
    playersInMatch,
    persistence: "required_if_available",
    source: "timeline_progression",
  });
}

/** Reassert durable persistence when an earlier best-effort report fetch supplied the timeline. */
export async function persistTimelineForProgression(
  timeline: RawTimeline,
  playersInMatch: PlayerConfigEntry[],
  matchId: RiotMatchId,
  matchData: RawMatch,
): Promise<void> {
  const staged = await recordTimelineForReportStore({
    timeline,
    source: "timeline_progression",
    trackedPlayerAliases: playersInMatch.map((player) => player.alias),
    gameCreatedAt: new Date(matchData.info.gameCreation),
  });
  requireTimelineStaging("required", staged, matchId);
}

/**
 * The timeline of a match whose canonical payload is the Scout Client's,
 * staged for the lake exactly as a Riot timeline is, so Dare SQL, challenges
 * and Explore read it the same way.
 *
 * Missing evidence remains recoverable by the desktop. Required processing
 * retries while optional reports can record their current missing coverage.
 */
async function recordClientTimeline(
  options: {
    readonly persistence: TimelinePersistence;
    readonly playersInMatch: PlayerConfigEntry[];
    readonly matchId: RiotMatchId;
    readonly matchData: RawMatch;
  },
  timeline: RawTimeline | null,
): Promise<RawTimeline | undefined> {
  if (timeline === null) {
    logger.info(
      `[generateMatchReport] Scout Client supplied ${options.matchId} without a timeline`,
    );
    requireAvailableTimeline(options);
    return undefined;
  }
  return await stageFetchedTimeline(
    { ...options, source: "timeline_scout_client" },
    timeline,
  );
}

function requireAvailableTimeline(options: {
  readonly persistence: TimelinePersistence;
  readonly matchId: RiotMatchId;
}): void {
  if (options.persistence === "required") {
    requireTimelineStaging(options.persistence, false, options.matchId);
  }
}

async function clientTimelineOrMissing(
  options: Parameters<typeof recordClientTimeline>[0],
  timeline: RawTimeline | undefined,
): Promise<RawTimeline | undefined> {
  if (timeline !== undefined)
    return await recordClientTimeline(options, timeline);
  requireAvailableTimeline(options);
  return undefined;
}

async function stageFetchedTimeline(
  options: {
    readonly persistence: TimelinePersistence;
    readonly source?: "timeline_progression" | "timeline_scout_client";
    readonly playersInMatch: PlayerConfigEntry[];
    readonly matchId: RiotMatchId;
    readonly matchData: RawMatch;
  },
  timeline: RawTimeline,
): Promise<RawTimeline> {
  logger.info(
    `[generateMatchReport] ✅ Timeline fetched with ${timeline.info.frames.length.toString()} frames`,
  );
  try {
    const trackedPlayerAliases = options.playersInMatch.map(
      (player) => player.alias,
    );
    const staged = await recordTimelineForReportStore({
      timeline,
      source:
        options.source ??
        (options.persistence === "required"
          ? "timeline_dare_v2"
          : "timeline_live"),
      trackedPlayerAliases,
      gameCreatedAt: new Date(options.matchData.info.gameCreation),
    });
    requireTimelineStaging(options.persistence, staged, options.matchId);
  } catch (error) {
    if (options.persistence !== "best_effort") throw error;
    logger.error(
      `[generateMatchReport] Error saving timeline ${options.matchId} to S3:`,
      error,
    );
  }
  return (await readFrozenTimeline(options.matchId)) ?? timeline;
}

async function fetchAndRecordTimeline(options: {
  matchData: RawMatch;
  matchId: RiotMatchId;
  playersInMatch: PlayerConfigEntry[];
  persistence: TimelinePersistence;
  source?: "timeline_progression";
}): Promise<RawTimeline | undefined> {
  // Ahead of the Arena exit: the League client records Arena timelines too,
  // and a client match never waits on Riot either way.
  const selection = await readTimelineSelection(
    options.matchId,
    options.matchData,
  );
  if (selection.source === "ARCHIVED")
    return await stageFetchedTimeline(options, selection.timeline);
  if (selection.source === "SCOUT_CLIENT") {
    return await recordClientTimeline(options, selection.timeline);
  }

  const firstPlayer = options.playersInMatch[0];
  if (
    firstPlayer === undefined ||
    isArenaQueueOrMode(
      options.matchData.info.queueId,
      options.matchData.info.gameMode,
    )
  ) {
    return await clientTimelineOrMissing(options, selection.clientTimeline);
  }

  const playerRegion = firstPlayer.league.leagueAccount.region;
  let timelineData: RawTimeline | undefined;
  try {
    logger.info(
      `[generateMatchReport] 📊 Fetching timeline data for match ${options.matchId}`,
    );
    timelineData = await fetchMatchTimeline(
      options.matchId,
      playerRegion,
      options.persistence === "required"
        ? "throw"
        : options.persistence === "required_if_available"
          ? "return_undefined_on_404"
          : "return_undefined",
    );
  } catch (error) {
    if (selection.clientTimeline !== undefined)
      return await recordClientTimeline(options, selection.clientTimeline);
    logger.error(
      `[generateMatchReport] ⚠️  Failed to fetch timeline, continuing without it:`,
      error,
    );
    Sentry.captureException(error, {
      tags: { source: "timeline-fetch-wrapper", matchId: options.matchId },
    });
    if (options.persistence !== "best_effort") throw error;
    return undefined;
  }
  if (timelineData === undefined) {
    if (selection.clientTimeline !== undefined)
      return await recordClientTimeline(options, selection.clientTimeline);
    requireAvailableTimeline(options);
    return;
  }
  return await stageFetchedTimeline(options, timelineData);
}
