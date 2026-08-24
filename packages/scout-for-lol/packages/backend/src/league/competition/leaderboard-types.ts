import type { LeaderboardEntry } from "#src/league/competition/processors/types.ts";

/**
 * A leaderboard entry once ranks have been assigned.
 *
 * The ranking helper consumes it and the leaderboard imports that helper back.
 */

export type RankedLeaderboardEntry = LeaderboardEntry & {
  rank: number;
};
