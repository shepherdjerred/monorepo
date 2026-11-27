import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { withLakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import {
  fetchFullMatch,
  fetchTimelineCheckpointFrames,
  fetchTimelineCoverage,
  fetchTimelineEventPage,
} from "#src/reports/duckdb/consumer/profile-lake-reads.ts";

/** Key events the Match header reads, which a long game never exceeds. */
const KEY_EVENT_LIMIT = 40;

/**
 * Everything `consumerMatch.detail` reads from the lake, in one report-pool
 * slot: the roster, the timeline's coverage, its key events and the lane
 * checkpoint frames. The reads are the same functions the standalone readers
 * use, run on one shared connection.
 *
 * Nothing it returns may reach the caller until the caller has confirmed the
 * viewer's player was in `rows`.
 */
export async function fetchMatchDetailRead(options: {
  matchId: RiotMatchId;
  checkpointMs: number;
  keyEventTypes: string[];
  lakeDir?: string;
}) {
  const { matchId } = options;
  return await withLakePage(options.lakeDir, async (page) => {
    const rows = await fetchFullMatch({ matchId, page });
    const coverage = await fetchTimelineCoverage({ matchId, page });
    const keyEvents = await fetchTimelineEventPage({
      matchId,
      offset: 0,
      limit: KEY_EVENT_LIMIT,
      eventTypes: options.keyEventTypes,
      page,
    });
    const laneDeltaFrames = await fetchTimelineCheckpointFrames({
      matchId,
      checkpointMs: options.checkpointMs,
      page,
    });
    return { rows, coverage, keyEvents, laneDeltaFrames };
  });
}
