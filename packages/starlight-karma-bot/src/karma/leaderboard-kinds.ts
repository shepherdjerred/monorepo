/** Which side of the exchange a leaderboard ranks.
 *
 *  Its own module so the command definition can reference it without pulling
 *  in the query layer (and therefore Prisma). */
export const LEADERBOARD_KINDS = ["received", "given"] as const;

export type LeaderboardKind = (typeof LEADERBOARD_KINDS)[number];
