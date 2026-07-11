/** Pure karma scoring and leaderboard helpers, extracted from the Discord
 *  command handlers so the behavior can be unit-tested without a live client
 *  or database. The command layer (commands.ts) composes these with I/O. */

/** Amount of karma applied when a user gives karma to someone else. */
export const KARMA_GIVE_AMOUNT = 1;

/** Penalty applied when a user tries to give karma to themselves. */
export const SELF_KARMA_PENALTY = -1;

/** Decide how much karma a give-interaction should apply.
 *  Giving to yourself is penalized; giving to anyone else awards a point. */
export function karmaAmountFor(giverId: string, receiverId: string): number {
  return giverId === receiverId ? SELF_KARMA_PENALTY : KARMA_GIVE_AMOUNT;
}

/** A single leaderboard input row: a user id and their summed karma. */
export type KarmaCount = {
  id: string;
  karmaReceived: number;
};

/** A ranked leaderboard row. `rank` uses dense ranking (1, 2, 2, 3): equal
 *  scores share a rank and the next distinct score takes the next integer. */
export type RankedEntry = KarmaCount & {
  rank: number;
};

/** Assign dense competition ranks to karma counts in their given order.
 *  Callers pass rows already sorted by karma descending (the DB view orders
 *  them); this function does not re-sort, matching the original handler. */
export function rankLeaderboard(counts: readonly KarmaCount[]): RankedEntry[] {
  const ranked: RankedEntry[] = [];
  let rank = 0;
  let prev: number | undefined;

  for (const count of counts) {
    if (count.karmaReceived !== prev) {
      rank++;
    }
    prev = count.karmaReceived;
    ranked.push({ ...count, rank });
  }

  return ranked;
}

/** Format a single leaderboard line. Top-3 ranks are emphasized by the caller
 *  via `emphasizeRank`; `displayName` is the already-resolved user label. */
export function formatLeaderboardLine(
  entry: RankedEntry,
  displayName: string,
): string {
  const rankString = `#${entry.rank.toString()}`;
  const shown = entry.rank <= 3 ? `**${rankString}**` : rankString;
  return `${shown}: ${displayName} (${entry.karmaReceived.toString()} karma)`;
}
