/**
 * When to warn players on The Storm's Discord about the quarterly mining-world
 * reset. The countdown runs once a day; the reset schedule's own next action
 * decides the date, so the two can never disagree.
 */
export type StormResetNotice = {
  readonly kind: "week" | "tomorrow";
  readonly content: string;
  /** A Discord nonce (at most 25 characters) so a retried post is sent once. */
  readonly nonce: string;
};

const HOUR_MS = 3_600_000;

/**
 * The notice to post at `now`, or null. A paused reset schedule is never
 * announced: players are only warned about a reset that will happen.
 */
export function stormResetNotice(
  now: Date,
  nextReset: Date | undefined,
  paused: boolean,
): StormResetNotice | null {
  if (paused || nextReset === undefined) return null;
  const hours = (nextReset.getTime() - now.getTime()) / HOUR_MS;
  const day = nextReset.toISOString().slice(0, 10);
  // The countdown runs daily, so each window holds exactly one run.
  if (hours > 6 * 24 && hours <= 7 * 24) {
    return {
      kind: "week",
      content: `The mining world resets in a week (${day}). Anything left there will be gone.`,
      nonce: `rst-${day}-week`,
    };
  }
  if (hours > 0 && hours <= 24) {
    return {
      kind: "tomorrow",
      content: `The mining world resets in the next day (${day}). Bring everything home now.`,
      nonce: `rst-${day}-tomorrow`,
    };
  }
  return null;
}
