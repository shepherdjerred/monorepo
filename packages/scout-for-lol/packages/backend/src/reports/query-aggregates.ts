import { REPORT_MAX_ROWS_LIMIT } from "@scout-for-lol/data";
import type { ReportMetric, ReportQueryPlan } from "@scout-for-lol/data";
import type { ReportQueryResult } from "#src/reports/query-engine.ts";

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

export function sortedAggregates(
  plan: ReportQueryPlan,
  rows: Iterable<AggregateRow>,
): AggregateRow[] {
  return [...rows]
    .filter((row) => plan.minGames === undefined || row.games >= plan.minGames)
    .toSorted((left, right) => compareAggregateRows(left, right, plan));
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
// and ratios guard division by zero (empty groups read 0).
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
