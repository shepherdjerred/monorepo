/** Pure milestone decisions. Persistence lives in `store.ts`, where the karma
 * write and high-water update share one transaction. */

export const KARMA_MILESTONES = [10, 25, 50, 100, 250, 500] as const;

/** The highest milestone reached at a total, or zero when none was reached. */
export function highestReachedMilestone(total: number): number {
  return KARMA_MILESTONES.findLast((milestone) => total >= milestone) ?? 0;
}

/** The highest not-yet-announced milestone crossed by this write, or null.
 *
 *  Returns the highest rather than the first so a single large give that
 *  vaults past two thresholds announces the more impressive one. */
export function crossedUnannouncedMilestone(
  before: number,
  after: number,
  highestAnnounced: number,
): number | null {
  if (after <= before) {
    return null;
  }
  return (
    KARMA_MILESTONES.findLast(
      (milestone) =>
        milestone > highestAnnounced &&
        before < milestone &&
        after >= milestone,
    ) ?? null
  );
}
