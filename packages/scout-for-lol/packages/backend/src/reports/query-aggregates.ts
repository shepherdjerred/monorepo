import { REPORT_MAX_ROWS_LIMIT } from "@scout-for-lol/data";
import type {
  ReportExpression,
  ReportMetric,
  ReportQueryPlan,
} from "@scout-for-lol/data";
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
  participantRows: number;
  earlySurrenders: number;
  laneMinions: number;
  neutralMinions: number;
  goldSpent: number;
  damageMitigated: number;
  damageToObjectives: number;
  damageToTurrets: number;
  healing: number;
  teammateHealing: number;
  wardsKilled: number;
  controlWardsBought: number;
  detectorWardsPlaced: number;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentaKills: number;
  largestMultikill: number;
  killingSprees: number;
  firstBloods: number;
  championLevelTotal: number;
  championExperienceTotal: number;
  timeDeadSeconds: number;
  longestLifeSeconds: number;
  ccTimeSeconds: number;
  turretKills: number;
  inhibitorKills: number;
  dragonKills: number;
  baronKills: number;
  arenaRows: number;
  placementSum: number;
  topTwoPlacements: number;
  firstPlaceFinishes: number;
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
    columns: ["label", ...plan.selectItems.map((item) => item.key)],
    rows: rows.slice(0, limit).map((row) => ({
      label: row.label,
      dimensions: row.label.split(" • "),
      discordId: row.discordId,
      values: plan.selectItems.map((item) => ({
        column: item.key,
        value: evaluateExpression(row, item.expression),
      })),
    })),
    rowsScanned,
  };
}

export function cappedLimit(plan: ReportQueryPlan, maxRows: number): number {
  return Math.min(plan.limit, maxRows, REPORT_MAX_ROWS_LIMIT);
}

export function sortedAggregates(
  plan: ReportQueryPlan,
  rows: Iterable<AggregateRow>,
): AggregateRow[] {
  return [...rows]
    .filter((row) => plan.minGames === undefined || row.games >= plan.minGames)
    .filter((row) => matchesHaving(row, plan))
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

  const selectItem = plan.selectItems.find((item) => item.key === plan.orderBy);
  const leftValue =
    selectItem === undefined
      ? plan.orderBy === "games"
        ? left.games
        : null
      : evaluateExpression(left, selectItem.expression);
  const rightValue =
    selectItem === undefined
      ? plan.orderBy === "games"
        ? right.games
        : null
      : evaluateExpression(right, selectItem.expression);
  if (leftValue === null && rightValue !== null) return 1;
  if (leftValue !== null && rightValue === null) return -1;
  const valueDiff = (leftValue ?? 0) - (rightValue ?? 0);
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
  early_surrenders: (row) => row.earlySurrenders,
  early_surrender_rate: (row) =>
    row.games === 0 ? 0 : row.earlySurrenders / row.games,
  lane_minions: (row) => row.laneMinions,
  neutral_minions: (row) => row.neutralMinions,
  gold_spent: (row) => row.goldSpent,
  damage_mitigated: (row) => row.damageMitigated,
  damage_to_objectives: (row) => row.damageToObjectives,
  damage_to_turrets: (row) => row.damageToTurrets,
  healing: (row) => row.healing,
  teammate_healing: (row) => row.teammateHealing,
  wards_killed: (row) => row.wardsKilled,
  control_wards_bought: (row) => row.controlWardsBought,
  detector_wards_placed: (row) => row.detectorWardsPlaced,
  double_kills: (row) => row.doubleKills,
  triple_kills: (row) => row.tripleKills,
  quadra_kills: (row) => row.quadraKills,
  penta_kills: (row) => row.pentaKills,
  largest_multikill: (row) => row.largestMultikill,
  killing_sprees: (row) => row.killingSprees,
  first_bloods: (row) => row.firstBloods,
  first_blood_rate: (row) =>
    row.games === 0 ? 0 : row.firstBloods / row.games,
  avg_champion_level: (row) =>
    row.participantRows === 0
      ? 0
      : row.championLevelTotal / row.participantRows,
  avg_champion_experience: (row) =>
    row.participantRows === 0
      ? 0
      : row.championExperienceTotal / row.participantRows,
  time_dead_seconds: (row) => row.timeDeadSeconds,
  longest_life_seconds: (row) => row.longestLifeSeconds,
  cc_time_seconds: (row) => row.ccTimeSeconds,
  turret_kills: (row) => row.turretKills,
  inhibitor_kills: (row) => row.inhibitorKills,
  dragon_kills: (row) => row.dragonKills,
  baron_kills: (row) => row.baronKills,
  arena_games: (row) => row.arenaRows,
  average_placement: (row) =>
    row.arenaRows === 0 ? 0 : row.placementSum / row.arenaRows,
  top_two_rate: (row) =>
    row.arenaRows === 0 ? 0 : row.topTwoPlacements / row.arenaRows,
  first_place_rate: (row) =>
    row.arenaRows === 0 ? 0 : row.firstPlaceFinishes / row.arenaRows,
};

export function metricValue(row: AggregateRow, metric: ReportMetric): number {
  return METRIC_VALUES[metric](row);
}

export function evaluateExpression(
  row: AggregateRow,
  expression: ReportExpression,
): number | null {
  if (expression.kind === "metric") {
    return metricValue(row, expression.metric);
  }
  if (expression.kind === "number") {
    return expression.value;
  }
  if (expression.kind === "binary") {
    return evaluateBinaryExpression(row, expression);
  }
  return evaluateFunctionExpression(row, expression);
}

function evaluateBinaryExpression(
  row: AggregateRow,
  expression: Extract<ReportExpression, { kind: "binary" }>,
): number | null {
  const left = evaluateExpression(row, expression.left);
  const right = evaluateExpression(row, expression.right);
  if (left === null || right === null) return null;
  switch (expression.operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right === 0 ? null : left / right;
  }
}

function evaluateFunctionExpression(
  row: AggregateRow,
  expression: Extract<ReportExpression, { kind: "function" }>,
): number | null {
  const values = expression.arguments.map((argument) =>
    evaluateExpression(row, argument),
  );
  if (expression.name === "coalesce") {
    return values[0] ?? values[1] ?? null;
  }
  const first = values[0];
  if (first === null || first === undefined) return null;
  if (expression.name === "per_game") {
    return row.games === 0 ? null : first / row.games;
  }
  if (expression.name === "per_minute") {
    return row.timePlayedSeconds === 0
      ? null
      : first / (row.timePlayedSeconds / 60);
  }
  const precision = values[1] ?? 0;
  if (!Number.isInteger(precision) || precision < 0 || precision > 10) {
    throw new Error("round precision must be an integer from 0 to 10.");
  }
  const scale = 10 ** precision;
  return Math.round(first * scale) / scale;
}

function matchesHaving(row: AggregateRow, plan: ReportQueryPlan): boolean {
  return plan.having.every((clause) => {
    const item = plan.selectItems.find(
      (candidate) => candidate.key === clause.key,
    );
    if (item === undefined) {
      throw new Error(`HAVING target "${clause.key}" is not a SELECT output.`);
    }
    const value = evaluateExpression(row, item.expression);
    if (value === null) return false;
    if (clause.operator === "=") return value === clause.value;
    if (clause.operator === "!=") return value !== clause.value;
    if (clause.operator === "<") return value < clause.value;
    if (clause.operator === "<=") return value <= clause.value;
    if (clause.operator === ">") return value > clause.value;
    return value >= clause.value;
  });
}
