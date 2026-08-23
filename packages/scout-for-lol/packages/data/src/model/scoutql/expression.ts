import { z } from "zod";

// ── ScoutQL v2 expression IR ─────────────────────────────────────────────────
// The expression trees a compiled plan carries. ScoutQL is a bounded subset of
// DuckDB SQL, so these are real trees: scalar expressions over raw lake
// columns, predicate trees with AND/OR/NOT, and aggregate expressions with
// FILTER/DISTINCT. Two invariants the shapes themselves enforce:
//
// - Scalar and aggregate expressions are DIFFERENT types, so an aggregate
//   nested inside a raw-row predicate (or inside another aggregate) is
//   unrepresentable, not merely invalid.
// - Every literal is a tree node the engine binds as a parameter. Column
//   identifiers are plain strings here, but the engine resolves them against
//   the closed lake-schema vocabulary — a name that is not a real column
//   fails compilation, so no user text can reach SQL.

export type ScoutQlCastType = z.infer<typeof ScoutQlCastTypeSchema>;
export const ScoutQlCastTypeSchema = z.enum([
  "int",
  "bigint",
  "double",
  "date",
  "timestamp",
  "varchar",
]);

export type ScoutQlIntervalUnit = z.infer<typeof ScoutQlIntervalUnitSchema>;
export const ScoutQlIntervalUnitSchema = z.enum([
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
]);

export type ScoutQlArithmeticOp = z.infer<typeof ScoutQlArithmeticOpSchema>;
export const ScoutQlArithmeticOpSchema = z.enum(["+", "-", "*", "/", "%"]);

export type ScoutQlCompareOp = z.infer<typeof ScoutQlCompareOpSchema>;
export const ScoutQlCompareOpSchema = z.enum([
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "like",
  "ilike",
]);

export type ScoutQlScalarFunction = z.infer<typeof ScoutQlScalarFunctionSchema>;
export const ScoutQlScalarFunctionSchema = z.enum([
  "round",
  "floor",
  "ceil",
  "abs",
  "coalesce",
  "nullif",
  "greatest",
  "least",
  "date_trunc",
]);

export type ScoutQlAggregateFunction = z.infer<
  typeof ScoutQlAggregateFunctionSchema
>;
export const ScoutQlAggregateFunctionSchema = z.enum([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "median",
  "stddev",
]);

/** Output/grouping name: the stable key render encodings reference. */
export const ScoutQlOutputNameSchema = z
  .string()
  .regex(/^[a-z_][a-z0-9_]{0,63}$/u);

// ── Scalar expressions (raw-row context: WHERE, FILTER, aggregate args) ──────

export type ScoutQlScalarExpr =
  | { kind: "column"; column: string }
  | { kind: "literal"; value: number | string | boolean }
  | { kind: "interval"; amount: number; unit: ScoutQlIntervalUnit }
  | { kind: "now"; which: "timestamp" | "date" }
  | { kind: "negate"; operand: ScoutQlScalarExpr }
  | {
      kind: "arithmetic";
      op: ScoutQlArithmeticOp;
      left: ScoutQlScalarExpr;
      right: ScoutQlScalarExpr;
    }
  | { kind: "at-time-zone"; operand: ScoutQlScalarExpr; timezone: string }
  | { kind: "cast"; to: ScoutQlCastType; operand: ScoutQlScalarExpr }
  | {
      kind: "scalar-call";
      func: ScoutQlScalarFunction;
      args: ScoutQlScalarExpr[];
    };

export const ScoutQlScalarExprSchema: z.ZodType<ScoutQlScalarExpr> = z.lazy(
  () =>
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("column"), column: z.string().min(1) }),
      z.object({
        kind: z.literal("literal"),
        value: z.union([z.number(), z.string(), z.boolean()]),
      }),
      z.object({
        kind: z.literal("interval"),
        amount: z.number().int().positive(),
        unit: ScoutQlIntervalUnitSchema,
      }),
      z.object({
        kind: z.literal("now"),
        which: z.enum(["timestamp", "date"]),
      }),
      z.object({ kind: z.literal("negate"), operand: ScoutQlScalarExprSchema }),
      z.object({
        kind: z.literal("arithmetic"),
        op: ScoutQlArithmeticOpSchema,
        left: ScoutQlScalarExprSchema,
        right: ScoutQlScalarExprSchema,
      }),
      z.object({
        kind: z.literal("at-time-zone"),
        operand: ScoutQlScalarExprSchema,
        timezone: z.string().min(1),
      }),
      z.object({
        kind: z.literal("cast"),
        to: ScoutQlCastTypeSchema,
        operand: ScoutQlScalarExprSchema,
      }),
      z.object({
        kind: z.literal("scalar-call"),
        func: ScoutQlScalarFunctionSchema,
        args: z.array(ScoutQlScalarExprSchema).min(1).max(8),
      }),
    ]),
);

// ── Predicates (raw-row context: WHERE and aggregate FILTER) ─────────────────

export type ScoutQlPredicate =
  | { kind: "and"; operands: ScoutQlPredicate[] }
  | { kind: "or"; operands: ScoutQlPredicate[] }
  | { kind: "not"; operand: ScoutQlPredicate }
  | {
      kind: "compare";
      op: ScoutQlCompareOp;
      left: ScoutQlScalarExpr;
      right: ScoutQlScalarExpr;
    }
  | {
      kind: "in";
      operand: ScoutQlScalarExpr;
      negated: boolean;
      items: (number | string)[];
    }
  | {
      kind: "between";
      operand: ScoutQlScalarExpr;
      negated: boolean;
      low: ScoutQlScalarExpr;
      high: ScoutQlScalarExpr;
    }
  | { kind: "is-null"; operand: ScoutQlScalarExpr; negated: boolean }
  // A `player('…')` conjunct: index into ScoutQlPlan.playerRefs. The engine
  // substitutes the resolved PUUID set at execution.
  | { kind: "player-ref"; index: number };

export const ScoutQlPredicateSchema: z.ZodType<ScoutQlPredicate> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("and"),
      operands: z.array(ScoutQlPredicateSchema).min(2),
    }),
    z.object({
      kind: z.literal("or"),
      operands: z.array(ScoutQlPredicateSchema).min(2),
    }),
    z.object({ kind: z.literal("not"), operand: ScoutQlPredicateSchema }),
    z.object({
      kind: z.literal("compare"),
      op: ScoutQlCompareOpSchema,
      left: ScoutQlScalarExprSchema,
      right: ScoutQlScalarExprSchema,
    }),
    z.object({
      kind: z.literal("in"),
      operand: ScoutQlScalarExprSchema,
      negated: z.boolean(),
      items: z
        .array(z.union([z.number(), z.string()]))
        .min(1)
        .max(50),
    }),
    z.object({
      kind: z.literal("between"),
      operand: ScoutQlScalarExprSchema,
      negated: z.boolean(),
      low: ScoutQlScalarExprSchema,
      high: ScoutQlScalarExprSchema,
    }),
    z.object({
      kind: z.literal("is-null"),
      operand: ScoutQlScalarExprSchema,
      negated: z.boolean(),
    }),
    z.object({
      kind: z.literal("player-ref"),
      index: z.number().int().nonnegative(),
    }),
  ]),
);

// ── Aggregate expressions (SELECT outputs, HAVING, ORDER BY) ─────────────────

export type ScoutQlAggregateExpr =
  | { kind: "count-star"; filter?: ScoutQlPredicate | undefined }
  | {
      kind: "aggregate";
      func: ScoutQlAggregateFunction;
      arg: ScoutQlScalarExpr;
      /** DISTINCT is meaningful for `count` only; analysis rejects the rest. */
      distinct: boolean;
      filter?: ScoutQlPredicate | undefined;
    }
  | {
      kind: "quantile";
      arg: ScoutQlScalarExpr;
      /** QUANTILE_CONT fraction, exclusive (0, 1). */
      q: number;
      filter?: ScoutQlPredicate | undefined;
    }
  | { kind: "literal"; value: number }
  | {
      kind: "arithmetic";
      op: ScoutQlArithmeticOp;
      left: ScoutQlAggregateExpr;
      right: ScoutQlAggregateExpr;
    }
  | {
      kind: "scalar-call";
      func: ScoutQlScalarFunction;
      args: ScoutQlAggregateExpr[];
    }
  // A reference to another output by alias — legal in HAVING and ORDER BY
  // (DuckDB semantics), never inside an output's own expression.
  | { kind: "output-ref"; name: string };

export const ScoutQlAggregateExprSchema: z.ZodType<ScoutQlAggregateExpr> =
  z.lazy(() =>
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("count-star"),
        filter: ScoutQlPredicateSchema.optional(),
      }),
      z.object({
        kind: z.literal("aggregate"),
        func: ScoutQlAggregateFunctionSchema,
        arg: ScoutQlScalarExprSchema,
        distinct: z.boolean(),
        filter: ScoutQlPredicateSchema.optional(),
      }),
      z.object({
        kind: z.literal("quantile"),
        arg: ScoutQlScalarExprSchema,
        q: z.number().gt(0).lt(1),
        filter: ScoutQlPredicateSchema.optional(),
      }),
      z.object({ kind: z.literal("literal"), value: z.number() }),
      z.object({
        kind: z.literal("arithmetic"),
        op: ScoutQlArithmeticOpSchema,
        left: ScoutQlAggregateExprSchema,
        right: ScoutQlAggregateExprSchema,
      }),
      z.object({
        kind: z.literal("scalar-call"),
        func: ScoutQlScalarFunctionSchema,
        args: z.array(ScoutQlAggregateExprSchema).min(1).max(8),
      }),
      z.object({
        kind: z.literal("output-ref"),
        name: ScoutQlOutputNameSchema,
      }),
    ]),
  );

// ── HAVING: boolean logic over aggregate expressions ─────────────────────────

export type ScoutQlHavingPredicate =
  | { kind: "and"; operands: ScoutQlHavingPredicate[] }
  | { kind: "or"; operands: ScoutQlHavingPredicate[] }
  | { kind: "not"; operand: ScoutQlHavingPredicate }
  | {
      kind: "compare";
      op: ScoutQlCompareOp;
      left: ScoutQlAggregateExpr;
      right: ScoutQlAggregateExpr;
    };

export const ScoutQlHavingPredicateSchema: z.ZodType<ScoutQlHavingPredicate> =
  z.lazy(() =>
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("and"),
        operands: z.array(ScoutQlHavingPredicateSchema).min(2),
      }),
      z.object({
        kind: z.literal("or"),
        operands: z.array(ScoutQlHavingPredicateSchema).min(2),
      }),
      z.object({
        kind: z.literal("not"),
        operand: ScoutQlHavingPredicateSchema,
      }),
      z.object({
        kind: z.literal("compare"),
        op: ScoutQlCompareOpSchema,
        left: ScoutQlAggregateExprSchema,
        right: ScoutQlAggregateExprSchema,
      }),
    ]),
  );

// ── Evidence: how a rendered value earns its confidence interval ─────────────
// Inferred at compile from the output's expression shape. Rate evidence keeps
// Wilson intervals working for `AVG(win::INT)`-shaped outputs, including under
// FILTER — the companions are what the interval actually needs; a blanket
// COUNT(*) would be wrong exactly when a FILTER narrows the denominator.

export type ScoutQlEvidence =
  | {
      kind: "rate";
      successes: ScoutQlAggregateExpr;
      trials: ScoutQlAggregateExpr;
    }
  | {
      kind: "ratio";
      numerator: ScoutQlAggregateExpr;
      denominator: ScoutQlAggregateExpr;
    }
  | { kind: "sample" };

export const ScoutQlEvidenceSchema: z.ZodType<ScoutQlEvidence> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("rate"),
      successes: ScoutQlAggregateExprSchema,
      trials: ScoutQlAggregateExprSchema,
    }),
    z.object({
      kind: z.literal("ratio"),
      numerator: ScoutQlAggregateExprSchema,
      denominator: ScoutQlAggregateExprSchema,
    }),
    z.object({ kind: z.literal("sample") }),
  ]),
);
