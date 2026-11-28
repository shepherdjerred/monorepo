import type { SnapshotChampion } from "#src/lib/champion-meta/snapshot-v2-schema.ts";

/**
 * "Does well against" and "Has a hard time against" for one role. Opponents
 * are ranked on the edge of their win-rate interval that is closer to even, so
 * a thin sample with a lucky rate does not top the list, and an opponent
 * appears only on the side its win rate is on.
 */

type Opponent = SnapshotChampion["matchups"][number]["opponents"][number];

export type MatchupRow = {
  id: number;
  name: string;
  slug: string;
  winRate: number;
  games: number;
  lane: { aheadRate: number; games: number } | null;
  /** "Wins lane, loses the game" and its reverse, only when both clear 50%. */
  note: string | null;
};

export type MatchupsModel = {
  wellAgainst: MatchupRow[];
  hardAgainst: MatchupRow[];
};

/** Rows listed on each side. */
const SIDE_ROWS = 3;

function noteOf(opponent: Opponent): string | null {
  if (opponent.lane === undefined) return null;
  const game = opponent.winRate.value;
  const lane = opponent.lane.aheadRate.value;
  if (lane > 0.5 && game < 0.5) return "Wins lane, loses the game";
  return lane < 0.5 && game > 0.5 ? "Loses lane, wins the game" : null;
}

function rowOf(opponent: Opponent): MatchupRow {
  return {
    id: opponent.id,
    name: opponent.name,
    slug: opponent.slug,
    winRate: opponent.winRate.value * 100,
    games: opponent.games,
    lane:
      opponent.lane === undefined
        ? null
        : {
            aheadRate: opponent.lane.aheadRate.value * 100,
            games: opponent.lane.games,
          },
    note: noteOf(opponent),
  };
}

export function matchupsModel(opponents: readonly Opponent[]): MatchupsModel {
  const wellAgainst = opponents
    .filter((opponent) => opponent.winRate.value > 0.5)
    .toSorted((a, b) => b.winRate.lower - a.winRate.lower)
    .slice(0, SIDE_ROWS)
    .map((opponent) => rowOf(opponent));
  const hardAgainst = opponents
    .filter((opponent) => opponent.winRate.value < 0.5)
    .toSorted((a, b) => a.winRate.upper - b.winRate.upper)
    .slice(0, SIDE_ROWS)
    .map((opponent) => rowOf(opponent));
  return { wellAgainst, hardAgainst };
}
