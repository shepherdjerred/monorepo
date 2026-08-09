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

export type MilestoneLedgerRow = {
  id: number;
  amount: number;
  datetime: Date;
  guildId: string;
  receiverId: string;
};

export type MilestoneStateSeed = {
  guildId: string;
  receiverId: string;
  highestAnnounced: number;
};

/** Derive durable milestone high-water state from an imported ledger.
 *
 * Current balance is insufficient: someone who reached 25 and later fell to
 * 24 must still be recorded at 25 or their next +1 would re-announce it. */
export function milestoneStateSeedsFromLedger(
  rows: readonly MilestoneLedgerRow[],
): MilestoneStateSeed[] {
  const ordered = rows.toSorted((left, right) => {
    const timeDifference = left.datetime.getTime() - right.datetime.getTime();
    return timeDifference === 0 ? left.id - right.id : timeDifference;
  });
  const states = new Map<
    string,
    Map<string, { runningTotal: number; highWater: number }>
  >();

  for (const row of ordered) {
    let guild = states.get(row.guildId);
    if (guild === undefined) {
      guild = new Map();
      states.set(row.guildId, guild);
    }
    const previous = guild.get(row.receiverId) ?? {
      runningTotal: 0,
      highWater: 0,
    };
    const runningTotal = previous.runningTotal + row.amount;
    guild.set(row.receiverId, {
      runningTotal,
      highWater: Math.max(previous.highWater, runningTotal),
    });
  }

  const seeds: MilestoneStateSeed[] = [];
  for (const [guildId, receivers] of states) {
    for (const [receiverId, state] of receivers) {
      const highestAnnounced = highestReachedMilestone(state.highWater);
      if (highestAnnounced > 0) {
        seeds.push({ guildId, receiverId, highestAnnounced });
      }
    }
  }
  return seeds;
}
