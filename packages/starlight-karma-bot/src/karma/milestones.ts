/** Milestone detection.
 *
 *  Pure and table-free on purpose: a crossing is derived by comparing the
 *  receiver's total before and after a single write, so there is no
 *  "already announced" state to keep in sync. Karma can go down (self-give
 *  penalties, undo), and this only fires on an upward crossing, so a total
 *  that oscillates around a threshold announces once per genuine crossing
 *  rather than repeatedly. */

export const KARMA_MILESTONES = [10, 25, 50, 100, 250, 500] as const;

/** The highest milestone crossed by moving from `before` to `after`, or null.
 *
 *  Returns the highest rather than the first so a single large give that
 *  vaults past two thresholds announces the more impressive one. */
export function crossedMilestone(before: number, after: number): number | null {
  if (after <= before) {
    return null;
  }
  const crossed = KARMA_MILESTONES.filter(
    (milestone) => before < milestone && after >= milestone,
  );
  return crossed.at(-1) ?? null;
}
