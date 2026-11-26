import type { ChampionId } from "#src/model/core/identifiers.ts";
import { LANE_ORDER, type Lane } from "#src/model/riot/lane.ts";

/**
 * Which tips to generate. The full matrix is every champion against every
 * other in every lane; most of it is never played, so it is pruned hard:
 *
 * - a (champion, lane) is viable when that lane holds at least
 *   `minChampionShare` of the champion's games and the champion is at least
 *   `minLaneShare` of the lane's picks;
 * - each viable (champion, lane) keeps opponents, most-played first, until
 *   they cover `opponentCoverage` of its games in the lane, at most
 *   `maxOpponents` of them;
 * - the generation unit is the unordered pair, because one call writes both
 *   directions, so a pair kept by either side is one unit and two ordered sets.
 *
 * Pure: the play counts come from a {@link TipPlanSource}.
 */

export type TipPlanRules = {
  minChampionShare: number;
  minLaneShare: number;
  opponentCoverage: number;
  maxOpponents: number;
};

export const DEFAULT_TIP_PLAN_RULES: TipPlanRules = {
  minChampionShare: 0.1,
  minLaneShare: 0.005,
  opponentCoverage: 0.6,
  maxOpponents: 15,
};

export type TipPlanChampionLane = {
  championId: ChampionId;
  lane: Lane;
  /** The champion's games in this lane. */
  games: number;
  /** The champion's games in every lane. */
  championGames: number;
};

export type TipPlanOpponent = {
  championId: ChampionId;
  /** Games of the champion against this opponent in the lane; may be an estimate. */
  games: number;
};

export type TipPlanSource = {
  /** Where the counts came from, for the plan summary. */
  readonly name: string;
  /** Every pick in the lane: the denominator of a champion's lane share. */
  laneGames: (lane: Lane) => number;
  championLanes: () => readonly TipPlanChampionLane[];
  /** The champion's opponents in the lane, in any order. */
  opponents: (championId: ChampionId, lane: Lane) => readonly TipPlanOpponent[];
};

export type PlannedChampionLane = {
  championId: ChampionId;
  lane: Lane;
  games: number;
  /** Opponents that get matchup tips, most-played first. */
  opponents: ChampionId[];
  /** Share of the champion's lane games those opponents cover. */
  coverage: number;
};

export type PlannedMatchupUnit = {
  lane: Lane;
  /** The unordered pair, lower id first. */
  championIds: readonly [ChampionId, ChampionId];
};

export type TipPlanLaneCounts = {
  championLanes: number;
  units: number;
};

export type TipPlanCounts = {
  /** Viable (champion, lane) pairs; each gets one general tip set. */
  championLanes: number;
  /** Unordered matchup pairs, one model call each. */
  units: number;
  /** Matchup tip sets written: two per unit. */
  orderedSets: number;
  byLane: Record<Lane, TipPlanLaneCounts>;
};

export type TipPlan = {
  source: string;
  rules: TipPlanRules;
  championLanes: PlannedChampionLane[];
  units: PlannedMatchupUnit[];
  counts: TipPlanCounts;
};

export function isViableChampionLane(
  sample: TipPlanChampionLane,
  laneGames: number,
  rules: TipPlanRules,
): boolean {
  return (
    sample.games > 0 &&
    sample.championGames > 0 &&
    laneGames > 0 &&
    sample.games / sample.championGames >= rules.minChampionShare &&
    sample.games / laneGames >= rules.minLaneShare
  );
}

/** Opponents most-played first until `opponentCoverage` of `games` is covered. */
export function selectOpponents(
  championId: ChampionId,
  games: number,
  opponents: readonly TipPlanOpponent[],
  rules: TipPlanRules,
): { opponents: ChampionId[]; coverage: number } {
  const ranked = opponents
    .filter(
      (opponent) => opponent.championId !== championId && opponent.games > 0,
    )
    .toSorted(
      (left, right) =>
        right.games - left.games || left.championId - right.championId,
    );
  const kept: ChampionId[] = [];
  let covered = 0;
  for (const opponent of ranked) {
    if (
      kept.length >= rules.maxOpponents ||
      covered >= rules.opponentCoverage * games
    ) {
      break;
    }
    kept.push(opponent.championId);
    covered += opponent.games;
  }
  return { opponents: kept, coverage: games > 0 ? covered / games : 0 };
}

function compareChampionLanes(
  left: { lane: Lane; championId: ChampionId },
  right: { lane: Lane; championId: ChampionId },
): number {
  return (
    LANE_ORDER.indexOf(left.lane) - LANE_ORDER.indexOf(right.lane) ||
    left.championId - right.championId
  );
}

export function planTips(
  source: TipPlanSource,
  rules: TipPlanRules = DEFAULT_TIP_PLAN_RULES,
): TipPlan {
  const championLanes: PlannedChampionLane[] = source
    .championLanes()
    .filter((sample) =>
      isViableChampionLane(sample, source.laneGames(sample.lane), rules),
    )
    .toSorted(compareChampionLanes)
    .map((sample) => ({
      championId: sample.championId,
      lane: sample.lane,
      games: sample.games,
      ...selectOpponents(
        sample.championId,
        sample.games,
        source.opponents(sample.championId, sample.lane),
        rules,
      ),
    }));

  const units = new Map<string, PlannedMatchupUnit>();
  for (const championLane of championLanes) {
    for (const opponent of championLane.opponents) {
      const pair: readonly [ChampionId, ChampionId] =
        championLane.championId < opponent
          ? [championLane.championId, opponent]
          : [opponent, championLane.championId];
      units.set(
        `${championLane.lane}:${pair[0].toString()}:${pair[1].toString()}`,
        {
          lane: championLane.lane,
          championIds: pair,
        },
      );
    }
  }
  const sortedUnits = [...units.values()].toSorted(
    (left, right) =>
      LANE_ORDER.indexOf(left.lane) - LANE_ORDER.indexOf(right.lane) ||
      left.championIds[0] - right.championIds[0] ||
      left.championIds[1] - right.championIds[1],
  );

  const laneCounts = (lane: Lane): TipPlanLaneCounts => ({
    championLanes: championLanes.filter((entry) => entry.lane === lane).length,
    units: sortedUnits.filter((unit) => unit.lane === lane).length,
  });
  const byLane: Record<Lane, TipPlanLaneCounts> = {
    top: laneCounts("top"),
    jungle: laneCounts("jungle"),
    middle: laneCounts("middle"),
    adc: laneCounts("adc"),
    support: laneCounts("support"),
  };

  return {
    source: source.name,
    rules,
    championLanes,
    units: sortedUnits,
    counts: {
      championLanes: championLanes.length,
      units: sortedUnits.length,
      orderedSets: sortedUnits.length * 2,
      byLane,
    },
  };
}
