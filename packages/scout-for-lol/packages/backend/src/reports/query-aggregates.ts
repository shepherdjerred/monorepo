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
  // Archived raw participant blob — the legacy group path picks the Arena
  // playerSubteamId out of it (the fact table has no dedicated column).
  rawParticipantJson?: string;
};

export type PrematchParticipantFactRow = {
  playerId: number;
  playerAlias: string;
  discordId: string | null;
  championId: number;
  queue: string | null;
};

export type AggregateRow = {
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
  // Lake-only counters: the legacy fact engine has no source columns for
  // these and always reports 0 (it is deleted with the fact tables).
  goldEarned: number;
  visionScore: number;
  damageTaken: number;
  totalDamageDealt: number;
  wardsPlaced: number;
  multikills: number;
  /** Sum of game durations (seconds), counted once per group row per game. */
  durationSeconds: number;
  /** Sum of time played (seconds) across group members. */
  timePlayedSeconds: number;
};

const EMPTY_LAKE_COUNTERS = {
  goldEarned: 0,
  visionScore: 0,
  damageTaken: 0,
  totalDamageDealt: 0,
  wardsPlaced: 0,
  multikills: 0,
  durationSeconds: 0,
  timePlayedSeconds: 0,
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

  return sortedAggregates(plan, byGroup.values());
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

  return sortedAggregates(plan, byGroup.values());
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

export function sortedAggregates(
  plan: ReportQueryPlan,
  rows: Iterable<AggregateRow>,
): AggregateRow[] {
  return [...rows]
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
    ...EMPTY_LAKE_COUNTERS,
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
  if (groupBy === "group") {
    throw new Error("group grouping requires the player_groups source.");
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
  if (groupBy === "group") {
    throw new Error("group grouping requires the player_groups source.");
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

// Exhaustive per-metric derivations over the raw aggregate counters. Rates
// and ratios guard division by zero (empty groups read 0, matching the
// legacy engine).
const METRIC_VALUES: Record<ReportMetric, (row: AggregateRow) => number> = {
  games: (row) => row.games,
  prematches: (row) => row.games,
  wins: (row) => row.wins,
  losses: (row) => row.games - row.wins,
  surrenders: (row) => row.surrenders,
  surrender_rate: (row) => (row.games === 0 ? 0 : row.surrenders / row.games),
  win_rate: (row) => (row.games === 0 ? 0 : row.wins / row.games),
  kills: (row) => row.kills,
  deaths: (row) => row.deaths,
  assists: (row) => row.assists,
  kda: (row) => {
    const takedowns = row.kills + row.assists;
    return row.deaths === 0 ? takedowns : takedowns / row.deaths;
  },
  creep_score: (row) => row.creepScore,
  damage_to_champions: (row) => row.damageToChampions,
  gold_earned: (row) => row.goldEarned,
  vision_score: (row) => row.visionScore,
  damage_taken: (row) => row.damageTaken,
  total_damage_dealt: (row) => row.totalDamageDealt,
  wards_placed: (row) => row.wardsPlaced,
  multikills: (row) => row.multikills,
  avg_game_duration: (row) =>
    row.games === 0 ? 0 : row.durationSeconds / row.games / 60,
  cs_per_minute: (row) =>
    row.timePlayedSeconds === 0
      ? 0
      : row.creepScore / (row.timePlayedSeconds / 60),
  score: (row) => row.games,
};

function metricValue(row: AggregateRow, metric: ReportMetric): number {
  return METRIC_VALUES[metric](row);
}
