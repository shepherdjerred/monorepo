import type { ChampionId } from "#src/model/core/identifiers.ts";
import {
  getChampionByKey,
  getChampionIdByName,
} from "#src/model/riot/champion-registry.ts";
import {
  LANE_ORDER,
  type Lane,
  LaneSchema,
  parseLane,
} from "#src/model/riot/lane.ts";
import type {
  PlannedChampionLane,
  PlannedMatchupUnit,
  TipPlan,
  TipPlanSource,
} from "#src/tips/plan.ts";

/**
 * Which part of the plan one run works on. The full plan is every viable
 * (champion, lane) and every kept pair; a selection narrows it by lane, by
 * explicit `lane/Champion[,Opponent]` selectors and by a limit on the
 * most-played pairs.
 */

export type TipKind = "matchup" | "general";

export type TipSelector = {
  lane: Lane;
  champion: ChampionId;
  /** Set for a single explicit pair; absent selects the champion everywhere in the lane. */
  opponent?: ChampionId;
};

export type TipSelection = {
  lane?: Lane | undefined;
  selectors: readonly TipSelector[];
  /** Keep only the most-played matchup units. */
  limit?: number | undefined;
  kinds: ReadonlySet<TipKind>;
};

export const ALL_TIPS: TipSelection = {
  selectors: [],
  kinds: new Set<TipKind>(["matchup", "general"]),
};

export type RankedMatchupUnit = PlannedMatchupUnit & {
  /** Estimated games of the pair in the lane, both directions. */
  games: number;
};

export type SelectedWork = {
  general: PlannedChampionLane[];
  matchups: RankedMatchupUnit[];
};

function resolveChampion(text: string): ChampionId {
  const trimmed = text.trim();
  const byKey = getChampionByKey(trimmed);
  const id = byKey?.id ?? getChampionIdByName(trimmed);
  if (id === undefined) {
    throw new Error(`unknown champion "${trimmed}"`);
  }
  return id;
}

/** A lane by its Scout name (`middle`, `adc`, `support`) or Riot's (`bottom`, `utility`). */
export function resolveLane(text: string): Lane | undefined {
  const scout = LaneSchema.safeParse(text.trim().toLowerCase());
  return scout.success ? scout.data : parseLane(text.trim());
}

/** `middle/Ahri` or `middle/Ahri,Syndra`; lane names as `parseLane` accepts them. */
export function parseTipSelector(text: string): TipSelector {
  const [laneText, championsText, ...rest] = text.split("/");
  if (
    laneText === undefined ||
    championsText === undefined ||
    rest.length > 0
  ) {
    throw new Error(`"${text}" is not lane/Champion[,Opponent]`);
  }
  const lane = resolveLane(laneText);
  if (lane === undefined) {
    throw new Error(`unknown lane "${laneText}" in "${text}"`);
  }
  const [championText, opponentText, ...extra] = championsText.split(",");
  if (championText === undefined || extra.length > 0) {
    throw new Error(`"${text}" is not lane/Champion[,Opponent]`);
  }
  const champion = resolveChampion(championText);
  if (opponentText === undefined) {
    return { lane, champion };
  }
  const opponent = resolveChampion(opponentText);
  if (opponent === champion) {
    throw new Error(`"${text}" names the same champion twice`);
  }
  return { lane, champion, opponent };
}

function orderedPair(
  left: ChampionId,
  right: ChampionId,
): readonly [ChampionId, ChampionId] {
  return left < right ? [left, right] : [right, left];
}

/** Estimated games of the pair: each side's games against the other, summed. */
export function pairGames(
  source: TipPlanSource,
  lane: Lane,
  championIds: readonly [ChampionId, ChampionId],
): number {
  const [first, second] = championIds;
  const against = (champion: ChampionId, opponent: ChampionId): number =>
    source
      .opponents(champion, lane)
      .find((entry) => entry.championId === opponent)?.games ?? 0;
  return against(first, second) + against(second, first);
}

function unitMatches(unit: PlannedMatchupUnit, selector: TipSelector): boolean {
  if (unit.lane !== selector.lane) {
    return false;
  }
  const [first, second] = unit.championIds;
  return selector.opponent === undefined
    ? first === selector.champion || second === selector.champion
    : orderedPair(selector.champion, selector.opponent)[0] === first &&
        orderedPair(selector.champion, selector.opponent)[1] === second;
}

function inLane(selection: TipSelection, lane: Lane): boolean {
  return selection.lane === undefined || selection.lane === lane;
}

function unitKey(unit: PlannedMatchupUnit): string {
  return `${unit.lane}:${unit.championIds[0].toString()}:${unit.championIds[1].toString()}`;
}

function generalKey(championId: ChampionId, lane: Lane): string {
  return `${lane}:${championId.toString()}`;
}

function selectMatchups(
  plan: TipPlan,
  source: TipPlanSource,
  selection: TipSelection,
): RankedMatchupUnit[] {
  if (!selection.kinds.has("matchup")) {
    return [];
  }
  const explicit = selection.selectors.length > 0;
  const byKey = new Map<string, PlannedMatchupUnit>();
  for (const unit of plan.units) {
    if (
      inLane(selection, unit.lane) &&
      (!explicit ||
        selection.selectors.some((selector) => unitMatches(unit, selector)))
    ) {
      byKey.set(unitKey(unit), unit);
    }
  }
  // An explicit pair is generated even when the plan pruned it.
  for (const selector of selection.selectors) {
    if (selector.opponent !== undefined && inLane(selection, selector.lane)) {
      const unit: PlannedMatchupUnit = {
        lane: selector.lane,
        championIds: orderedPair(selector.champion, selector.opponent),
      };
      byKey.set(unitKey(unit), unit);
    }
  }
  const ranked = [...byKey.values()]
    .map((unit): RankedMatchupUnit => ({
      ...unit,
      games: pairGames(source, unit.lane, unit.championIds),
    }))
    .toSorted(
      (left, right) =>
        right.games - left.games ||
        LANE_ORDER.indexOf(left.lane) - LANE_ORDER.indexOf(right.lane) ||
        left.championIds[0] - right.championIds[0] ||
        left.championIds[1] - right.championIds[1],
    );
  return ranked.slice(0, selection.limit ?? ranked.length);
}

function selectsChampionLane(
  selection: TipSelection,
  entry: { championId: ChampionId; lane: Lane },
): boolean {
  return selection.selectors.some(
    (selector) =>
      selector.opponent === undefined &&
      selector.lane === entry.lane &&
      selector.champion === entry.championId,
  );
}

function selectGeneral(
  plan: TipPlan,
  selection: TipSelection,
): PlannedChampionLane[] {
  if (!selection.kinds.has("general")) {
    return [];
  }
  const explicit = selection.selectors.length > 0;
  const byKey = new Map<string, PlannedChampionLane>();
  for (const entry of plan.championLanes) {
    if (
      inLane(selection, entry.lane) &&
      (!explicit || selectsChampionLane(selection, entry))
    ) {
      byKey.set(generalKey(entry.championId, entry.lane), entry);
    }
  }
  // An explicit champion is generated even when the plan found it not viable.
  for (const selector of selection.selectors) {
    const key = generalKey(selector.champion, selector.lane);
    if (
      selector.opponent === undefined &&
      inLane(selection, selector.lane) &&
      !byKey.has(key)
    ) {
      byKey.set(key, {
        championId: selector.champion,
        lane: selector.lane,
        games: 0,
        opponents: [],
        coverage: 0,
      });
    }
  }
  return [...byKey.values()].toSorted(
    (left, right) =>
      right.games - left.games ||
      LANE_ORDER.indexOf(left.lane) - LANE_ORDER.indexOf(right.lane) ||
      left.championId - right.championId,
  );
}

export function selectWork(
  plan: TipPlan,
  source: TipPlanSource,
  selection: TipSelection,
): SelectedWork {
  return {
    general: selectGeneral(plan, selection),
    matchups: selectMatchups(plan, source, selection),
  };
}
