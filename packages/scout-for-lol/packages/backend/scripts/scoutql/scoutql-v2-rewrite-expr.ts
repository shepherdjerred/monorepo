import type {
  LegacyExpression,
  LegacyMetric,
} from "./scoutql-legacy-bridge.ts";
import { unconvertible } from "./scoutql-v2-unconvertible.ts";

// ── Route B, half one: legacy metric/expression → v2 query TEXT ──────────────
// The legacy language had 56 named metrics whose meaning lived in the engine
// (`METRIC_VALUES` in reports/query-aggregates.ts) and whose counters lived in
// a static SELECT list (`metrics-sql.ts`). v2 has no metric enum: every output
// is an explicit aggregate over a physical lake column. This table is the
// migration's half of that translation — the OTHER half is the IR table in
// scoutql-v2-legacy-metrics.ts, written independently so that a mistake in
// either shows up as a two-route plan mismatch rather than as a silently
// wrong report.
//
// Every entry reproduces the legacy derivation exactly:
//   wins       = SUM(CASE WHEN win THEN 1 ELSE 0 END)        → COUNT(*) FILTER
//   win_rate   = wins / games                                → AVG(win::INT)
//   arena rates = top_two / arena_rows, where arena_rows counts NON-NULL
//     placements — which is exactly AVG's NULL handling, so
//     `AVG((placement <= 2)::INT)` is the same number, not an approximation.

type MetricRewrite = {
  /** v2 expression text. */
  text: string;
  /** Set when `text` is `SUM(<column>)`; powers per_game / per_minute. */
  sumColumn?: string;
  /** False when `text` has a top-level operator and needs parenthesizing. */
  atomic?: boolean;
};

function sum(column: string): MetricRewrite {
  return { text: `SUM(${column})`, sumColumn: column };
}

function flagCount(column: string): MetricRewrite {
  return { text: `COUNT(*) FILTER (WHERE ${column})` };
}

function flagRate(column: string): MetricRewrite {
  return { text: `AVG(${column}::INT)` };
}

const METRIC_REWRITES: Record<LegacyMetric, MetricRewrite> = {
  games: { text: "COUNT(*)" },
  prematches: { text: "COUNT(*)" },
  score: { text: "MAX(score)" },
  wins: flagCount("win"),
  losses: { text: "COUNT(*) FILTER (WHERE NOT win)" },
  surrenders: flagCount("surrendered"),
  early_surrenders: flagCount("early_surrendered"),
  first_bloods: flagCount("first_blood_kill"),
  win_rate: flagRate("win"),
  surrender_rate: flagRate("surrendered"),
  early_surrender_rate: flagRate("early_surrendered"),
  first_blood_rate: flagRate("first_blood_kill"),
  kills: sum("kills"),
  deaths: sum("deaths"),
  assists: sum("assists"),
  creep_score: sum("creep_score"),
  damage_to_champions: sum("total_damage_dealt_to_champions"),
  gold_earned: sum("gold_earned"),
  gold_spent: sum("gold_spent"),
  vision_score: sum("vision_score"),
  damage_taken: sum("total_damage_taken"),
  total_damage_dealt: sum("total_damage_dealt"),
  wards_placed: sum("wards_placed"),
  wards_killed: sum("wards_killed"),
  lane_minions: sum("total_minions_killed"),
  neutral_minions: sum("neutral_minions_killed"),
  damage_mitigated: sum("damage_self_mitigated"),
  damage_to_objectives: sum("damage_dealt_to_objectives"),
  damage_to_turrets: sum("damage_dealt_to_turrets"),
  healing: sum("total_heal"),
  teammate_healing: sum("total_heals_on_teammates"),
  control_wards_bought: sum("vision_wards_bought_in_game"),
  detector_wards_placed: sum("detector_wards_placed"),
  double_kills: sum("double_kills"),
  triple_kills: sum("triple_kills"),
  quadra_kills: sum("quadra_kills"),
  penta_kills: sum("penta_kills"),
  killing_sprees: sum("killing_sprees"),
  turret_kills: sum("turret_kills"),
  inhibitor_kills: sum("inhibitor_kills"),
  dragon_kills: sum("dragon_kills"),
  baron_kills: sum("baron_kills"),
  time_dead_seconds: sum("total_time_spent_dead"),
  cc_time_seconds: sum("time_ccing_others"),
  multikills: {
    text: "SUM(double_kills + triple_kills + quadra_kills + penta_kills)",
  },
  largest_multikill: { text: "MAX(largest_multi_kill)" },
  longest_life_seconds: { text: "MAX(longest_time_spent_living)" },
  kda: { text: "kda()" },
  cs_per_minute: { text: "per_minute(creep_score)" },
  avg_game_duration: {
    text: "AVG(game_duration_seconds) / 60",
    atomic: false,
  },
  avg_champion_level: { text: "AVG(champ_level)" },
  avg_champion_experience: { text: "AVG(champ_experience)" },
  arena_games: { text: "COUNT(placement)" },
  average_placement: { text: "AVG(placement)" },
  top_two_rate: { text: "AVG((placement <= 2)::INT)" },
  first_place_rate: { text: "AVG((placement = 1)::INT)" },
};

/** The v2 text a legacy metric becomes, with no surrounding parentheses. */
function metricText(metric: LegacyMetric): string {
  return METRIC_REWRITES[metric].text;
}

/** The column a metric sums, for the `per_game` / `per_minute` shortcuts. */
function metricSumColumn(metric: LegacyMetric): string | undefined {
  return METRIC_REWRITES[metric].sumColumn;
}

function isAtomic(expression: LegacyExpression): boolean {
  if (expression.kind === "metric") {
    return METRIC_REWRITES[expression.metric].atomic !== false;
  }
  return expression.kind !== "binary";
}

/** Print an operand of a binary operator, parenthesized when it is compound. */
function operandText(expression: LegacyExpression): string {
  const text = rewriteExpression(expression);
  return isAtomic(expression) ? text : `(${text})`;
}

function perAggregateText(
  expression: LegacyExpression,
  denominator: string,
  macro: (column: string) => string,
): string {
  if (expression.kind === "metric") {
    const column = metricSumColumn(expression.metric);
    if (column !== undefined) {
      // `per_game(kills)` is legacy for SUM(kills) / COUNT(*), which is AVG's
      // definition for a column the lake never leaves null. Preferring the
      // shorter form keeps the migrated query idiomatic and, for per_minute,
      // reaches the v2 macro that carries the same divide-by-zero guard.
      return macro(column);
    }
  }
  return `${operandText(expression)} / ${denominator}`;
}

/** Translate a legacy SELECT expression into v2 expression text. */
export function rewriteExpression(expression: LegacyExpression): string {
  if (expression.kind === "metric") {
    return metricText(expression.metric);
  }
  if (expression.kind === "number") {
    return expression.value.toString();
  }
  if (expression.kind === "binary") {
    return `${operandText(expression.left)} ${expression.operator} ${operandText(expression.right)}`;
  }
  const [first, second] = expression.arguments;
  if (first === undefined) {
    return unconvertible(`${expression.name}() has no argument.`);
  }
  if (expression.name === "round") {
    const digits = second === undefined ? "" : `, ${rewriteExpression(second)}`;
    return `ROUND(${rewriteExpression(first)}${digits})`;
  }
  if (expression.name === "coalesce") {
    if (second === undefined) {
      return unconvertible("COALESCE needs two arguments.");
    }
    return `COALESCE(${rewriteExpression(first)}, ${rewriteExpression(second)})`;
  }
  if (expression.name === "per_game") {
    return perAggregateText(first, "COUNT(*)", (column) => `AVG(${column})`);
  }
  return perAggregateText(
    first,
    "NULLIF(SUM(time_played) / 60, 0)",
    (column) => `per_minute(${column})`,
  );
}
