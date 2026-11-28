import { cn } from "#src/lib/cn.ts";

export type GameResult = "win" | "loss";

export type CurrentStreak = { result: GameResult; length: number };

/**
 * The run of identical results at the newest end of a list ordered oldest to
 * newest. A single game is a streak of one; `undefined` only for no games.
 */
export function currentStreak(
  results: readonly GameResult[],
): CurrentStreak | undefined {
  const newest = results.at(-1);
  if (newest === undefined) return undefined;
  let length = 0;
  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (results[index] !== newest) break;
    length += 1;
  }
  return { result: newest, length };
}

/** The text a screen reader gets in place of the dots. */
export function resultStripSummary(results: readonly GameResult[]): string {
  if (results.length === 0) return "No games yet.";
  const streak = currentStreak(results);
  const games = `${String(results.length)} ${results.length === 1 ? "game" : "games"}`;
  const list = results.join(", ");
  const streakText =
    streak === undefined || streak.length < 2
      ? ""
      : ` Current streak: ${String(streak.length)} ${streak.result === "win" ? "wins" : "losses"}.`;
  return `The last ${games}, oldest first: ${list}.${streakText}`;
}

export type ResultStripProps = {
  /** Oldest first, newest last. Longer lists keep only the newest `slots`. */
  results: readonly GameResult[];
  /** How many dots the strip draws; empty slots sit at the old end. */
  slots?: number;
  /** The shortest streak that gets the soft highlight. */
  minStreak?: number;
  /** Replaces the generated summary. */
  label?: string;
  className?: string;
};

/**
 * Win and loss dots, oldest to newest, with the current streak softly
 * highlighted. Wins are filled discs; losses are hollow rings in the loss
 * colour, so the two read apart without relying on hue alone.
 */
export function ResultStrip({
  results,
  slots = 20,
  minStreak = 2,
  label,
  className,
}: ResultStripProps) {
  const shown = results.slice(-slots);
  const empty = Math.max(0, slots - shown.length);
  const streak = currentStreak(shown);
  const streakLength =
    streak !== undefined && streak.length >= minStreak ? streak.length : 0;
  const plain = shown.slice(0, shown.length - streakLength);
  const run = shown.slice(shown.length - streakLength);

  return (
    <div
      className={cn("scout-result-strip", className)}
      role="img"
      aria-label={label ?? resultStripSummary(shown)}
    >
      {Array.from({ length: empty }, (_, index) => (
        <i key={`empty-${String(index)}`} className="scout-result-strip__dot" />
      ))}
      {plain.map((result, index) => (
        <i
          key={`game-${String(index)}`}
          className="scout-result-strip__dot"
          data-result={result}
        />
      ))}
      {streakLength === 0 || streak === undefined ? null : (
        <span
          className="scout-result-strip__streak"
          data-result={streak.result}
        >
          {run.map((result, index) => (
            <i
              key={`streak-${String(index)}`}
              className="scout-result-strip__dot"
              data-result={result}
            />
          ))}
        </span>
      )}
    </div>
  );
}
