import { REPORT_MAX_ROWS_LIMIT } from "@scout-for-lol/data";
import type {
  ReportGroupBy,
  ReportMetric,
  ReportQueryPlan,
} from "@scout-for-lol/data";
import type { ReportQueryResult } from "#src/reports/query-engine.ts";

export type MatchParticipantFactRow = {
  playerId: number;
  playerAlias: string;
  discordId: string | null;
  matchId: string;
  gameCreationAt: Date;
  championId: number;
  championName: string;
  queue: string | null;
  teamId: number;
  win: boolean;
  surrendered: boolean;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  damageToChampions: number;
};

export type PrematchParticipantFactRow = {
  playerId: number;
  playerAlias: string;
  discordId: string | null;
  championId: number;
  queue: string | null;
};

type AggregateRow = {
  label: string;
  discordId: string | null;
  games: number;
  wins: number;
  surrenders: number;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  damageToChampions: number;
};

export function aggregateMatchFacts(
  facts: MatchParticipantFactRow[],
  plan: ReportQueryPlan,
): AggregateRow[] {
  const byGroup = new Map<string, AggregateRow>();

  for (const fact of facts) {
    const key = groupKey(fact, plan.groupBy);
    const current = byGroup.get(key) ?? emptyAggregate(fact, plan.groupBy);
    addMatchFact(current, fact);
    byGroup.set(key, current);
  }

  return sortedAggregates(plan, byGroup);
}

export function aggregatePrematchFacts(
  facts: PrematchParticipantFactRow[],
  plan: ReportQueryPlan,
): AggregateRow[] {
  const byGroup = new Map<string, AggregateRow>();

  for (const fact of facts) {
    const key = groupKey(fact, plan.groupBy);
    const current = byGroup.get(key) ?? emptyAggregate(fact, plan.groupBy);
    current.games++;
    byGroup.set(key, current);
  }

  return sortedAggregates(plan, byGroup);
}

export function aggregatePairFacts(
  facts: MatchParticipantFactRow[],
  plan: ReportQueryPlan,
): AggregateRow[] {
  const byTeam = new Map<string, MatchParticipantFactRow[]>();
  for (const fact of facts) {
    const key = `${fact.matchId}:${fact.teamId.toString()}`;
    byTeam.set(key, [...(byTeam.get(key) ?? []), fact]);
  }

  const byPair = new Map<string, AggregateRow>();
  for (const teammates of byTeam.values()) {
    const uniquePlayers = uniquePlayerFacts(teammates);
    addPairRows(byPair, uniquePlayers);
  }

  return sortedAggregates(plan, byPair);
}

export function rowsFromAggregates(
  plan: ReportQueryPlan,
  rows: AggregateRow[],
  rowsScanned: number,
  maxRows: number,
): ReportQueryResult {
  const limit = cappedLimit(plan, maxRows);
  return {
    plan,
    columns: ["label", ...plan.metrics],
    rows: rows.slice(0, limit).map((row) => ({
      label: row.label,
      discordId: row.discordId,
      values: plan.metrics.map((metric) => ({
        column: metric,
        value: metricValue(row, metric),
      })),
    })),
    rowsScanned,
  };
}

export function cappedLimit(plan: ReportQueryPlan, maxRows: number): number {
  const limit = Math.min(plan.limit ?? maxRows, maxRows);
  return Math.min(limit, REPORT_MAX_ROWS_LIMIT);
}

function addPairRows(
  byPair: Map<string, AggregateRow>,
  uniquePlayers: MatchParticipantFactRow[],
): void {
  for (let leftIndex = 0; leftIndex < uniquePlayers.length; leftIndex++) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < uniquePlayers.length;
      rightIndex++
    ) {
      const left = uniquePlayers[leftIndex];
      const right = uniquePlayers[rightIndex];
      if (left === undefined || right === undefined) {
        continue;
      }
      addPairRow(byPair, left, right);
    }
  }
}

function addPairRow(
  byPair: Map<string, AggregateRow>,
  left: MatchParticipantFactRow,
  right: MatchParticipantFactRow,
): void {
  const pair = orderedPair(left, right);
  const current =
    byPair.get(pair.key) ?? emptyPairAggregate(pair.left, pair.right);
  current.games++;
  if (left.win && right.win) {
    current.wins++;
  }
  if (left.surrendered || right.surrendered) {
    current.surrenders++;
  }
  current.kills += left.kills + right.kills;
  current.deaths += left.deaths + right.deaths;
  current.assists += left.assists + right.assists;
  current.creepScore += left.creepScore + right.creepScore;
  current.damageToChampions += left.damageToChampions + right.damageToChampions;
  byPair.set(pair.key, current);
}

function uniquePlayerFacts(
  facts: MatchParticipantFactRow[],
): MatchParticipantFactRow[] {
  const byPlayer = new Map<number, MatchParticipantFactRow>();
  for (const fact of facts) {
    byPlayer.set(fact.playerId, fact);
  }
  return [...byPlayer.values()].toSorted(
    (left, right) => left.playerId - right.playerId,
  );
}

function orderedPair(
  left: MatchParticipantFactRow,
  right: MatchParticipantFactRow,
): {
  key: string;
  left: MatchParticipantFactRow;
  right: MatchParticipantFactRow;
} {
  if (left.playerId <= right.playerId) {
    return {
      key: `${left.playerId.toString()}:${right.playerId.toString()}`,
      left,
      right,
    };
  }
  return {
    key: `${right.playerId.toString()}:${left.playerId.toString()}`,
    left: right,
    right: left,
  };
}

function emptyPairAggregate(
  left: MatchParticipantFactRow,
  right: MatchParticipantFactRow,
): AggregateRow {
  return {
    label: `${left.playerAlias} + ${right.playerAlias}`,
    discordId: null,
    games: 0,
    wins: 0,
    surrenders: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 0,
    damageToChampions: 0,
  };
}

function addMatchFact(row: AggregateRow, fact: MatchParticipantFactRow): void {
  row.games++;
  if (fact.win) {
    row.wins++;
  }
  if (fact.surrendered) {
    row.surrenders++;
  }
  row.kills += fact.kills;
  row.deaths += fact.deaths;
  row.assists += fact.assists;
  row.creepScore += fact.creepScore;
  row.damageToChampions += fact.damageToChampions;
}

function sortedAggregates(
  plan: ReportQueryPlan,
  byGroup: Map<string, AggregateRow>,
): AggregateRow[] {
  return [...byGroup.values()]
    .filter((row) => plan.minGames === undefined || row.games >= plan.minGames)
    .toSorted((left, right) => compareAggregateRows(left, right, plan));
}

function emptyAggregate(
  fact: MatchParticipantFactRow | PrematchParticipantFactRow,
  groupBy: ReportGroupBy,
): AggregateRow {
  return {
    label: groupLabel(fact, groupBy),
    discordId: groupBy === "player" ? fact.discordId : null,
    games: 0,
    wins: 0,
    surrenders: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 0,
    damageToChampions: 0,
  };
}

function groupKey(
  fact: MatchParticipantFactRow | PrematchParticipantFactRow,
  groupBy: ReportGroupBy,
): string {
  if (groupBy === "player") {
    return `player:${fact.playerId.toString()}`;
  }
  if (groupBy === "champion") {
    return `champion:${fact.championId.toString()}`;
  }
  if (groupBy === "pair") {
    throw new Error("pair grouping requires the player_pairs source.");
  }
  return `queue:${fact.queue ?? "unknown"}`;
}

function groupLabel(
  fact: MatchParticipantFactRow | PrematchParticipantFactRow,
  groupBy: ReportGroupBy,
): string {
  if (groupBy === "player") {
    return fact.playerAlias;
  }
  if (groupBy === "champion") {
    return "championName" in fact
      ? fact.championName
      : fact.championId.toString();
  }
  if (groupBy === "pair") {
    throw new Error("pair grouping requires the player_pairs source.");
  }
  return fact.queue ?? "unknown";
}

function compareAggregateRows(
  left: AggregateRow,
  right: AggregateRow,
  plan: ReportQueryPlan,
): number {
  const direction = plan.orderDirection === "asc" ? 1 : -1;
  if (plan.orderBy === "label") {
    return direction * left.label.localeCompare(right.label);
  }

  const valueDiff =
    metricValue(left, plan.orderBy) - metricValue(right, plan.orderBy);
  if (valueDiff !== 0) {
    return direction * valueDiff;
  }

  return left.label.localeCompare(right.label);
}

function metricValue(row: AggregateRow, metric: ReportMetric): number {
  if (metric === "games" || metric === "prematches") {
    return row.games;
  }
  if (metric === "wins") {
    return row.wins;
  }
  if (metric === "losses") {
    return row.games - row.wins;
  }
  if (metric === "surrenders") {
    return row.surrenders;
  }
  if (metric === "surrender_rate") {
    return row.games === 0 ? 0 : row.surrenders / row.games;
  }
  if (metric === "win_rate") {
    return row.games === 0 ? 0 : row.wins / row.games;
  }
  if (metric === "kills") {
    return row.kills;
  }
  if (metric === "deaths") {
    return row.deaths;
  }
  if (metric === "assists") {
    return row.assists;
  }
  if (metric === "kda") {
    const takedowns = row.kills + row.assists;
    return row.deaths === 0 ? takedowns : takedowns / row.deaths;
  }
  if (metric === "creep_score") {
    return row.creepScore;
  }
  if (metric === "score") {
    return row.games;
  }
  return row.damageToChampions;
}
