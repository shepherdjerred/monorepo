import type { ReportDisplayKind, ReportRenderSpec } from "@scout-for-lol/data";
import type {
  ScoutQlAggregateExpr,
  ScoutQlEvidence,
  ScoutQlHavingPredicate,
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/expression.ts";
import type {
  ScoutQlGrouping,
  ScoutQlOrderKey,
  ScoutQlPlan,
  ScoutQlTimeWindow,
} from "@scout-for-lol/data/model/scoutql/plan.ts";
import { parseScoutQlPlan } from "@scout-for-lol/data/model/scoutql/plan.ts";
import {
  isLegacySnapshotSource,
  legacyTimeColumn,
  type LegacyExpression,
  type LegacyFilter,
  type LegacyFilterValue,
  type LegacyGroupBy,
  type LegacyPlan,
} from "./scoutql-legacy-bridge.ts";
import {
  aggregate,
  column,
  meanOf,
  perMinute,
  METRIC_TRANSLATIONS,
  type MetricTranslation,
} from "./scoutql-v2-legacy-metrics.ts";
import { unconvertible } from "./scoutql-v2-unconvertible.ts";

// ── Route A: legacy plan IR → ScoutQL v2 plan IR ─────────────────────────────
// The independent verification route. It reads the compiled LEGACY plan and
// builds the v2 plan the migrated query must mean, without ever seeing the
// rewritten text — no shared code with the text rewriter, not even its metric
// table. The migration then compiles the rewritten text through the real v2
// analyzer and requires the two plans to be deeply equal.
//
// Comparing a rewrite against itself proves nothing, which is the whole reason
// this exists: a metric pointed at the wrong lake column, a conjunct spliced
// into the wrong clause, a lost LIMIT, or a window that silently widened all
// show up here as a mismatch that fails startup by row id.

function literal(value: number | string | boolean): ScoutQlScalarExpr {
  return { kind: "literal", value };
}

// ── Expressions ──────────────────────────────────────────────────────────────

const SAMPLE: ScoutQlEvidence = { kind: "sample" };

function isNumeric(expression: LegacyExpression): boolean {
  return expression.kind === "number";
}

function quotientEvidence(
  left: MetricTranslation,
  right: MetricTranslation,
): ScoutQlEvidence {
  return left.additive && right.additive
    ? { kind: "ratio", numerator: left.expr, denominator: right.expr }
    : SAMPLE;
}

type BinaryOperands = {
  operator: "+" | "-" | "*" | "/";
  leftExpr: LegacyExpression;
  rightExpr: LegacyExpression;
  left: MetricTranslation;
  right: MetricTranslation;
};

/**
 * A total stays accumulable through +/-, through scaling by a constant, and
 * through division by a constant — and through nothing else. Summing averages
 * across buckets does not produce the overall average.
 */
function binaryAdditive(operands: BinaryOperands): boolean {
  const { operator, left, right } = operands;
  if (operator === "+" || operator === "-") {
    return left.additive && right.additive;
  }
  if (operator === "*") {
    return (
      (left.additive && isNumeric(operands.rightExpr)) ||
      (isNumeric(operands.leftExpr) && right.additive)
    );
  }
  return left.additive && isNumeric(operands.rightExpr);
}

function quotient(
  left: MetricTranslation,
  right: MetricTranslation,
  additive: boolean,
): MetricTranslation {
  return {
    expr: { kind: "arithmetic", op: "/", left: left.expr, right: right.expr },
    displayKind: "decimal",
    additive,
    evidence: quotientEvidence(left, right),
  };
}

const PER_GAME_DENOMINATOR: MetricTranslation = {
  expr: { kind: "count-star" },
  displayKind: "count",
  additive: true,
  evidence: SAMPLE,
};

const PER_MINUTE_DENOMINATOR: MetricTranslation = {
  expr: {
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
  displayKind: "decimal",
  // NULLIF(total, 0) is a divide-by-zero guard, not a transform, so the total
  // it wraps stays accumulable — which is what earns the quotient its ratio
  // evidence.
  additive: true,
  evidence: SAMPLE,
};

/** The lake column a metric sums, when it is exactly `SUM(<column>)`. */
function summedColumn(expression: LegacyExpression): string | undefined {
  if (expression.kind !== "metric") return undefined;
  const { expr } = METRIC_TRANSLATIONS[expression.metric];
  if (expr.kind !== "aggregate" || expr.func !== "sum") return undefined;
  return expr.arg.kind === "column" ? expr.arg.column : undefined;
}

function translateCall(
  expression: Extract<LegacyExpression, { kind: "function" }>,
): MetricTranslation {
  const [first, second] = expression.arguments;
  if (first === undefined) {
    return unconvertible(`${expression.name}() has no argument.`);
  }
  if (expression.name === "round") {
    const inner = translateExpression(first);
    const digits =
      second === undefined ? [] : [translateExpression(second).expr];
    return {
      expr: {
        kind: "scalar-call",
        func: "round",
        args: [inner.expr, ...digits],
      },
      // ROUND is transparent to display and evidence and opaque to additivity:
      // a rounded total no longer sums to the rounded whole.
      displayKind: inner.displayKind,
      additive: false,
      evidence: inner.evidence,
    };
  }
  if (expression.name === "coalesce") {
    if (second === undefined) {
      return unconvertible("COALESCE needs two arguments.");
    }
    return {
      expr: {
        kind: "scalar-call",
        func: "coalesce",
        args: [
          translateExpression(first).expr,
          translateExpression(second).expr,
        ],
      },
      displayKind: "decimal",
      additive: false,
      evidence: SAMPLE,
    };
  }
  const summed = summedColumn(first);
  if (expression.name === "per_game") {
    return summed === undefined
      ? quotient(translateExpression(first), PER_GAME_DENOMINATOR, false)
      : meanOf(summed);
  }
  return summed === undefined
    ? quotient(translateExpression(first), PER_MINUTE_DENOMINATOR, false)
    : perMinute(summed);
}

function translateExpression(expression: LegacyExpression): MetricTranslation {
  if (expression.kind === "metric") {
    return METRIC_TRANSLATIONS[expression.metric];
  }
  if (expression.kind === "number") {
    return {
      expr: { kind: "literal", value: expression.value },
      displayKind: "decimal",
      additive: false,
      evidence: SAMPLE,
    };
  }
  if (expression.kind === "function") {
    return translateCall(expression);
  }
  const left = translateExpression(expression.left);
  const right = translateExpression(expression.right);
  const additive = binaryAdditive({
    operator: expression.operator,
    leftExpr: expression.left,
    rightExpr: expression.right,
    left,
    right,
  });
  if (expression.operator === "/") {
    return quotient(left, right, additive);
  }
  return {
    expr: {
      kind: "arithmetic",
      op: expression.operator,
      left: left.expr,
      right: right.expr,
    },
    displayKind: "decimal",
    additive,
    evidence: SAMPLE,
  };
}

// ── Predicates ───────────────────────────────────────────────────────────────

const LOWERCASE_TEXT_COLUMNS = new Set(["queue"]);
const UPPERCASE_TEXT_COLUMNS = new Set([
  "game_mode",
  "game_type",
  "team_position",
  "individual_position",
  "lane",
  "role",
]);
const FILTER_COLUMNS: Record<string, string> = {
  damage_to_champions: "total_damage_dealt_to_champions",
};

function canonicalValue(
  field: string,
  value: LegacyFilterValue,
): number | string | boolean {
  if (typeof value !== "string") return value;
  if (LOWERCASE_TEXT_COLUMNS.has(field)) return value.toLowerCase();
  if (UPPERCASE_TEXT_COLUMNS.has(field)) return value.toUpperCase();
  if (field === "game_version" && !/[a-z]/iu.test(value)) return value;
  return unconvertible(
    `${field} was compared case-insensitively by the legacy engine; v2 compares exactly and the lake's casing for it is unknown.`,
  );
}

function filterPredicate(filter: LegacyFilter): ScoutQlPredicate {
  const name = FILTER_COLUMNS[filter.field] ?? filter.field;
  const values = filter.values.map((value) =>
    canonicalValue(filter.field, value),
  );
  if (filter.operator !== "in") {
    const [only] = values;
    if (only === undefined) {
      return unconvertible(`Filter ${filter.field} has no value.`);
    }
    return {
      kind: "compare",
      op: filter.operator,
      left: column(name),
      right: literal(only),
    };
  }
  if (values.some((value) => typeof value === "boolean")) {
    const operands = values.map((value): ScoutQlPredicate => ({
      kind: "compare",
      op: "=",
      left: column(name),
      right: literal(value),
    }));
    const [only] = operands;
    if (only !== undefined && operands.length === 1) return only;
    return { kind: "or", operands };
  }
  const items = values.flatMap((value) =>
    typeof value === "boolean" ? [] : [value],
  );
  return { kind: "in", operand: column(name), negated: false, items };
}

function wherePredicate(plan: LegacyPlan): ScoutQlPredicate | undefined {
  const operands: ScoutQlPredicate[] = [];
  if (plan.queueFilter !== undefined && plan.queueFilter.length > 0) {
    operands.push({
      kind: "in",
      operand: column("queue"),
      negated: false,
      items: plan.queueFilter.map((queue) => queue.toLowerCase()),
    });
  }
  if (plan.championId !== undefined) {
    operands.push({
      kind: "compare",
      op: "=",
      left: column("champion_id"),
      right: literal(plan.championId),
    });
  }
  plan.playerRefs.forEach((_name, index) => {
    operands.push({ kind: "player-ref", index });
  });
  for (const filter of plan.filters) {
    operands.push(filterPredicate(filter));
  }
  const [only] = operands;
  if (only === undefined) return undefined;
  return operands.length === 1 ? only : { kind: "and", operands };
}

// ── Whole-plan assembly ──────────────────────────────────────────────────────

function timeWindow(plan: LegacyPlan): ScoutQlTimeWindow {
  if (isLegacySnapshotSource(plan.source)) return { kind: "snapshot" };
  const window = plan.window;
  if (window.kind === "all_time") return { kind: "unbounded" };
  if (window.kind === "relative") {
    return { kind: "relative", amount: window.days, unit: "day" };
  }
  return {
    kind: "calendar",
    startDate: window.startDate,
    endDate: window.endDate,
    timezone: window.timezone,
  };
}

function grouping(
  dimension: Exclude<LegacyGroupBy, "all">,
  plan: LegacyPlan,
): ScoutQlGrouping {
  if (dimension === "group") {
    const size = plan.groupSize;
    if (size === undefined) {
      return unconvertible("GROUP BY group(...) is missing its size.");
    }
    return { kind: "group", size, name: "group" };
  }
  if (dimension === "day" || dimension === "week" || dimension === "month") {
    return {
      kind: "date-trunc",
      part: dimension,
      column: legacyTimeColumn(plan.source),
      timezone: plan.analysis?.timezone ?? "UTC",
      name: dimension,
    };
  }
  return { kind: "column", column: dimension, name: dimension };
}

/** `GROUP BY all` was legacy for a grand total, which v2 spells as no GROUP BY. */
function groupings(plan: LegacyPlan): ScoutQlGrouping[] {
  return plan.groupBys.flatMap((dimension) =>
    dimension === "all" ? [] : [grouping(dimension, plan)],
  );
}

function havingPredicate(plan: LegacyPlan): ScoutQlHavingPredicate | undefined {
  const operands: ScoutQlHavingPredicate[] = [];
  if (plan.minGames !== undefined) {
    const countsGames = plan.selectItems.some(
      (item) =>
        item.key === "games" &&
        item.expression.kind === "metric" &&
        item.expression.metric === "games",
    );
    const left: ScoutQlAggregateExpr = countsGames
      ? { kind: "output-ref", name: "games" }
      : { kind: "count-star" };
    operands.push({
      kind: "compare",
      op: ">=",
      left,
      right: { kind: "literal", value: plan.minGames },
    });
  }
  for (const clause of plan.having) {
    operands.push({
      kind: "compare",
      op: clause.operator,
      left: { kind: "output-ref", name: clause.key },
      right: { kind: "literal", value: clause.value },
    });
  }
  const [only] = operands;
  if (only === undefined) return undefined;
  return operands.length === 1 ? only : { kind: "and", operands };
}

function orderKeys(plan: LegacyPlan, dimensions: number): ScoutQlOrderKey[] {
  const direction = plan.orderDirection;
  if (plan.orderBy !== "label") {
    if (!plan.selectItems.some((item) => item.key === plan.orderBy)) {
      return unconvertible(
        `ORDER BY sorted by "${plan.orderBy}", which this query does not SELECT — v2 has no implicit games-column default to fall back to.`,
      );
    }
    return [{ target: { kind: "output", name: plan.orderBy }, direction }];
  }
  if (dimensions !== 1) {
    return unconvertible(
      "ORDER BY sorted by the combined grouping label, which v2 has no single key for.",
    );
  }
  return [{ target: { kind: "grouping", index: 0 }, direction }];
}

function renderSpec(plan: LegacyPlan): ReportRenderSpec {
  const comparison = plan.analysis?.comparison;
  if (comparison === undefined) return plan.render;
  if (comparison.kind === "calendar") {
    return unconvertible("COMPARE TO BETWEEN has no v2 equivalent.");
  }
  const render = plan.render;
  if (!("encoding" in render)) {
    return unconvertible(
      `RENDER ${render.kind.toLowerCase()} cannot carry compare = previous_period.`,
    );
  }
  return {
    ...render,
    options: { ...render.options, compare: "previous_period" },
  };
}

function outputDisplayKind(
  name: string,
  inferred: ReportDisplayKind,
  render: ReportRenderSpec,
): ReportDisplayKind {
  if (!("options" in render) || render.options === undefined) {
    return inferred;
  }
  const options = render.options;
  const override = "format" in options ? options.format?.[name] : undefined;
  return override ?? inferred;
}

/** Translate a compiled legacy plan into the ScoutQL v2 plan it must become. */
export function legacyPlanToV2(plan: LegacyPlan): ScoutQlPlan {
  const dimensions = groupings(plan);
  const render = renderSpec(plan);
  const outputs = plan.selectItems.map((item) => {
    const translated = translateExpression(item.expression);
    return {
      name: item.key,
      expr: translated.expr,
      displayKind: outputDisplayKind(item.key, translated.displayKind, render),
      additive: translated.additive,
      evidence: translated.evidence,
    };
  });
  return parseScoutQlPlan({
    source: plan.source,
    outputs,
    where: wherePredicate(plan),
    timeWindow: timeWindow(plan),
    groupings: dimensions,
    having: havingPredicate(plan),
    orderBy: orderKeys(plan, dimensions.length),
    limit: plan.limit,
    playerRefs: plan.playerRefs,
    competitionId: plan.competitionId,
    render,
  });
}
