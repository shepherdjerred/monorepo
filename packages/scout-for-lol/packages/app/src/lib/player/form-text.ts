/** A run of identical results, as `consumerPlayer` reports it. */
export type StreakInput = {
  result: "win" | "loss";
  games: number;
  /** The read stopped inside the run: it is at least this long. */
  atLeast: boolean;
};

/** The fewest games in a row that count as a streak. */
export const MIN_STREAK_GAMES = 2;

/**
 * "a 3-game win streak" or "a 3-game losing streak", the noun phrase a
 * sentence builds on. Undefined below two games: one result is not a streak.
 */
export function streakPhrase(streak: StreakInput | null): string | undefined {
  if (streak === null || streak.games < MIN_STREAK_GAMES) return undefined;
  const kind = streak.result === "win" ? "win" : "losing";
  return streak.atLeast
    ? `a ${kind} streak of ${streak.games.toLocaleString("en-US")} games or more`
    : `a ${streak.games.toString()}-game ${kind} streak`;
}

/** "Won 12 of the last 20". One game reads as the game itself. */
export function wonOfLast(wins: number, games: number): string {
  if (games === 1)
    return wins === 1 ? "Won the last game" : "Lost the last game";
  return `Won ${wins.toString()} of the last ${games.toString()}`;
}
