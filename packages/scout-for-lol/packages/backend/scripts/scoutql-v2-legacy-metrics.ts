import type { ReportDisplayKind } from "@scout-for-lol/data";
import type {
  ScoutQlAggregateExpr,
  ScoutQlEvidence,
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/expression.ts";
import type { LegacyMetric } from "./scoutql-legacy-bridge.ts";

// ── Route A, half one: legacy metric → v2 plan IR ────────────────────────────
// The independent twin of scoutql-v2-rewrite-expr.ts. That module says what a
// legacy metric LOOKS like in v2 text; this one says what it MEANS in the v2
// plan IR, including the three inferences the analyzer derives from an
// expression's shape (display kind, additivity, evidence). Neither module
// imports the other, so a mistake in either — a wrong lake column, a rate
// written as a plain average, an aggregate that should have been a MAX — shows
// up as a two-route plan mismatch instead of as a quietly wrong report.

export type MetricTranslation = {
  expr: ScoutQlAggregateExpr;
  displayKind: ReportDisplayKind;
  additive: boolean;
  evidence: ScoutQlEvidence;
};

export function column(name: string): ScoutQlScalarExpr {
  return { kind: "column", column: name };
}

export function aggregate(
  func: "count" | "sum" | "avg" | "min" | "max" | "median" | "stddev",
  arg: ScoutQlScalarExpr,
): ScoutQlAggregateExpr {
  return { kind: "aggregate", func, arg, distinct: false };
}

function isTrue(name: string): ScoutQlPredicate {
  return { kind: "compare", op: "=", left: column(name), right: literal(true) };
}

function literal(value: number | string | boolean): ScoutQlScalarExpr {
  return { kind: "literal", value };
}

const SAMPLE: ScoutQlEvidence = { kind: "sample" };

/** COUNT(*) — the games/prematches counter. */
function total(): MetricTranslation {
  return {
    expr: { kind: "count-star" },
    displayKind: "count",
    additive: true,
    evidence: SAMPLE,
  };
}

/** COUNT(*) FILTER (WHERE <predicate>) — a conditional row count. */
function conditionalTotal(filter: ScoutQlPredicate): MetricTranslation {
  return {
    expr: { kind: "count-star", filter },
    displayKind: "count",
    additive: true,
    evidence: SAMPLE,
  };
}

/** Raw counters that display as durations because they hold seconds. */
const DURATION_COLUMNS = new Set([
  "game_duration_seconds",
  "time_played",
  "total_time_spent_dead",
  "longest_time_spent_living",
  "time_ccing_others",
]);

function counterDisplay(name: string): ReportDisplayKind {
  if (DURATION_COLUMNS.has(name)) return "duration";
  // The rank sources' `score` is the only DOUBLE column a legacy metric
  // aggregates; SUM/MIN/MAX preserve whole numbers, so every other one counts.
  return name === "score" ? "decimal" : "count";
}

/** SUM(<counter>) — additive, and a whole number, so it formats as a count. */
function summed(name: string): MetricTranslation {
  return {
    expr: aggregate("sum", column(name)),
    displayKind: counterDisplay(name),
    additive: true,
    evidence: SAMPLE,
  };
}

/** MAX(<counter>) — a peak, so summing it across buckets means nothing. */
function peak(name: string): MetricTranslation {
  return {
    expr: aggregate("max", column(name)),
    displayKind: counterDisplay(name),
    additive: false,
    evidence: SAMPLE,
  };
}

/**
 * AVG(<boolean>::INT) — the rate shape. Its Wilson interval needs the
 * successes and trials counts, which the analyzer rebuilds from the same cast.
 * Trials is COUNT(the cast), not COUNT(*): AVG ignores NULL, so for a nullable
 * operand — `(placement <= 2)` outside Arena — only the rows AVG averaged
 * belong in the denominator.
 */
function rateOf(operand: ScoutQlScalarExpr): MetricTranslation {
  const cast: ScoutQlScalarExpr = { kind: "cast", to: "int", operand };
  return {
    expr: aggregate("avg", cast),
    displayKind: "percent",
    additive: false,
    evidence: {
      kind: "rate",
      successes: aggregate("sum", cast),
      trials: aggregate("count", cast),
    },
  };
}

/** AVG(<column>) — a mean, whose evidence is its own sum over its own count. */
export function meanOf(name: string): MetricTranslation {
  return {
    expr: aggregate("avg", column(name)),
    displayKind: DURATION_COLUMNS.has(name) ? "duration" : "decimal",
    additive: false,
    evidence: {
      kind: "ratio",
      numerator: aggregate("sum", column(name)),
      denominator: aggregate("count", column(name)),
    },
  };
}

function flagRate(name: string): MetricTranslation {
  return rateOf(column(name));
}

/**
 * A rate over a derived condition: `AVG((placement <= 2)::INT)`.
 *
 * Legacy counted top-two finishes over the number of rows that HAD a placement
 * — Arena rows only. AVG drops the NULLs from both halves, so this is the same
 * number rather than an approximation of it.
 */
function comparisonRate(
  name: string,
  op: "=" | "<=",
  value: number,
): MetricTranslation {
  return rateOf({
    kind: "predicate",
    predicate: {
      kind: "compare",
      op,
      left: column(name),
      right: literal(value),
    },
  });
}

/** (kills + assists) / GREATEST(deaths, 1) — legacy's perfect-KDA semantics. */
function kda(): MetricTranslation {
  return {
    expr: {
      kind: "arithmetic",
      op: "/",
      left: {
        kind: "arithmetic",
        op: "+",
        left: aggregate("sum", column("kills")),
        right: aggregate("sum", column("assists")),
      },
      right: {
        kind: "scalar-call",
        func: "greatest",
        args: [
          aggregate("sum", column("deaths")),
          { kind: "literal", value: 1 },
        ],
      },
    },
    displayKind: "ratio",
    additive: false,
    evidence: SAMPLE,
  };
}

/** per_minute(x) — SUM(x) over minutes played, guarded against a zero. */
export function perMinute(name: string): MetricTranslation {
  return {
    expr: {
      kind: "arithmetic",
      op: "/",
      left: aggregate("sum", column(name)),
      right: {
        kind: "scalar-call",
        func: "nullif",
        args: [
          {
            kind: "arithmetic",
            op: "/",
            left: aggregate("sum", column("time_played")),
            right: { kind: "literal", value: 60 },
          },
          { kind: "literal", value: 0 },
        ],
      },
    },
    displayKind: "ratio",
    additive: false,
    evidence: SAMPLE,
  };
}

/** AVG(game_duration_seconds) / 60 — average game length in minutes. */
function averageMinutes(): MetricTranslation {
  return {
    expr: {
      kind: "arithmetic",
      op: "/",
      left: aggregate("avg", column("game_duration_seconds")),
      right: { kind: "literal", value: 60 },
    },
    displayKind: "decimal",
    additive: false,
    evidence: SAMPLE,
  };
}

export const METRIC_TRANSLATIONS: Record<LegacyMetric, MetricTranslation> = {
  games: total(),
  prematches: total(),
  score: peak("score"),
  wins: conditionalTotal(isTrue("win")),
  losses: conditionalTotal({ kind: "not", operand: isTrue("win") }),
  surrenders: conditionalTotal(isTrue("surrendered")),
  early_surrenders: conditionalTotal(isTrue("early_surrendered")),
  first_bloods: conditionalTotal(isTrue("first_blood_kill")),
  win_rate: flagRate("win"),
  surrender_rate: flagRate("surrendered"),
  early_surrender_rate: flagRate("early_surrendered"),
  first_blood_rate: flagRate("first_blood_kill"),
  kills: summed("kills"),
  deaths: summed("deaths"),
  assists: summed("assists"),
  creep_score: summed("creep_score"),
  damage_to_champions: summed("total_damage_dealt_to_champions"),
  gold_earned: summed("gold_earned"),
  gold_spent: summed("gold_spent"),
  vision_score: summed("vision_score"),
  damage_taken: summed("total_damage_taken"),
  total_damage_dealt: summed("total_damage_dealt"),
  wards_placed: summed("wards_placed"),
  wards_killed: summed("wards_killed"),
  lane_minions: summed("total_minions_killed"),
  neutral_minions: summed("neutral_minions_killed"),
  damage_mitigated: summed("damage_self_mitigated"),
  damage_to_objectives: summed("damage_dealt_to_objectives"),
  damage_to_turrets: summed("damage_dealt_to_turrets"),
  healing: summed("total_heal"),
  teammate_healing: summed("total_heals_on_teammates"),
  control_wards_bought: summed("vision_wards_bought_in_game"),
  detector_wards_placed: summed("detector_wards_placed"),
  double_kills: summed("double_kills"),
  triple_kills: summed("triple_kills"),
  quadra_kills: summed("quadra_kills"),
  penta_kills: summed("penta_kills"),
  killing_sprees: summed("killing_sprees"),
  turret_kills: summed("turret_kills"),
  inhibitor_kills: summed("inhibitor_kills"),
  dragon_kills: summed("dragon_kills"),
  baron_kills: summed("baron_kills"),
  time_dead_seconds: summed("total_time_spent_dead"),
  cc_time_seconds: summed("time_ccing_others"),
  multikills: {
    expr: aggregate("sum", {
      kind: "arithmetic",
      op: "+",
      left: {
        kind: "arithmetic",
        op: "+",
        left: {
          kind: "arithmetic",
          op: "+",
          left: column("double_kills"),
          right: column("triple_kills"),
        },
        right: column("quadra_kills"),
      },
      right: column("penta_kills"),
    }),
    displayKind: "count",
    additive: true,
    evidence: SAMPLE,
  },
  largest_multikill: peak("largest_multi_kill"),
  longest_life_seconds: peak("longest_time_spent_living"),
  kda: kda(),
  cs_per_minute: perMinute("creep_score"),
  avg_game_duration: averageMinutes(),
  avg_champion_level: meanOf("champ_level"),
  avg_champion_experience: meanOf("champ_experience"),
  arena_games: {
    expr: aggregate("count", column("placement")),
    displayKind: "count",
    additive: true,
    evidence: SAMPLE,
  },
  average_placement: meanOf("placement"),
  top_two_rate: comparisonRate("placement", "<=", 2),
  first_place_rate: comparisonRate("placement", "=", 1),
};
