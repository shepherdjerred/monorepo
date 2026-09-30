import type { RiotTeamId } from "@scout-for-lol/data";
import { nomineeAt, type MatchMvpRoster } from "#src/mvp-votes/roster.ts";
import type { StoredMatchMvpVote } from "#src/mvp-votes/vote.ts";

export type MatchMvpVoteGroup = {
  nomineeIndex: number;
  votes: readonly StoredMatchMvpVote[];
};

/** Cluster one side's ballots by nominee so Discord and web tallies share a loop. */
export function groupMatchMvpVotesForTeam(
  votes: readonly StoredMatchMvpVote[],
  teamId: RiotTeamId,
  roster: MatchMvpRoster,
): MatchMvpVoteGroup[] {
  const byIndex = new Map<number, StoredMatchMvpVote[]>();
  for (const vote of votes) {
    if (nomineeAt(roster, vote.nomineeIndex).teamId !== teamId) {
      continue;
    }
    const grouped = byIndex.get(vote.nomineeIndex);
    if (grouped === undefined) {
      byIndex.set(vote.nomineeIndex, [vote]);
    } else {
      grouped.push(vote);
    }
  }
  return [...byIndex.entries()]
    .toSorted((left, right) => {
      const countDelta = right[1].length - left[1].length;
      return countDelta === 0 ? left[0] - right[0] : countDelta;
    })
    .map(([nomineeIndex, grouped]) => ({
      nomineeIndex,
      votes: grouped,
    }));
}
