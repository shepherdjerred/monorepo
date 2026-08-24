import { match } from "ts-pattern";
import type {
  ScoutQlAggregateExpr,
  ScoutQlHavingPredicate,
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/expression.ts";
import { collectPredicateColumnNames } from "#src/reports/duckdb/expr-sql.ts";
import type { LakeScalar } from "#src/reports/duckdb/row-schema.ts";

/**
 * A JS evaluator for ScoutQL aggregate expressions over already-folded rows.
 *
 * Every other source aggregates in SQL. `player_groups` cannot: a teammate
 * group is a k-subset of the tracked players in one game, so the unit the
 * aggregate runs over is manufactured in JS (group-combinations.ts) and never
 * exists as a relation DuckDB could GROUP BY. This module is what makes those
 * folded rows answer the same expression language — kept honest by a
 * SQL-vs-JS differential test.
 *
 * DuckDB semantics are followed deliberately: an aggregate over an empty set
 * is NULL (COUNT is 0), division by zero is NULL, STDDEV is the SAMPLE
 * standard deviation, and QUANTILE_CONT interpolates linearly.
 */

export type FactRow = ReadonlyMap<string, LakeScalar>;

export type AggregateEvalContext = {
  /** The folded rows this group aggregates over (one per group-game). */
  rows: readonly FactRow[];
  /** Outputs already evaluated for this row, for HAVING/ORDER alias refs. */
  outputs: ReadonlyMap<string, LakeScalar>;
  /**
   * Columns a FILTER may reference: the game-level columns, identical across a
   * group's members. A member-scoped counter has no per-row truth value once
   * the members are summed, so filtering on one is refused rather than
   * answered against the sum.
   */
  filterableColumns: ReadonlySet<string>;
};

function unsupported(what: string): never {
  throw new Error(
    `${what} is not supported by the JS aggregate evaluator (player_groups and rank sources fold their rows in JS, so only column references, literals, arithmetic, casts and the scalar functions are available).`,
  );
}

function asNumber(value: LakeScalar, what: string): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new Error(`${what} expects a number, got "${value}".`);
}

// ── Scalar expressions over one folded row ───────────────────────────────────

export function evaluateScalar(
  expr: ScoutQlScalarExpr,
  row: FactRow,
): LakeScalar {
  return (
    match(expr)
      .with({ kind: "column" }, (node) => {
        if (!row.has(node.column)) {
          throw new Error(
            `Column "${node.column}" is not available on a teammate-group row.`,
          );
        }
        return row.get(node.column) ?? null;
      })
      .with({ kind: "literal" }, (node) => node.value)
      .with({ kind: "interval" }, () => unsupported("INTERVAL"))
      .with({ kind: "now" }, () => unsupported("CURRENT_TIMESTAMP"))
      .with({ kind: "at-time-zone" }, () => unsupported("AT TIME ZONE"))
      .with({ kind: "negate" }, (node) => {
        const value = asNumber(evaluateScalar(node.operand, row), "Negation");
        return value === null ? null : -value;
      })
      .with({ kind: "arithmetic" }, (node) =>
        arithmetic(
          node.op,
          asNumber(evaluateScalar(node.left, row), "Arithmetic"),
          asNumber(evaluateScalar(node.right, row), "Arithmetic"),
        ),
      )
      // A predicate used as a value: `AVG((placement <= 2)::INT)`. SQL has no
      // separate condition type, and neither does this evaluator — the same
      // predicate evaluator answers, so the JS fold agrees with the SQL path on
      // conditional rates.
      .with({ kind: "predicate" }, (node) =>
        evaluatePredicate(node.predicate, row),
      )
      .with({ kind: "cast" }, (node) =>
        cast(node.to, evaluateScalar(node.operand, row)),
      )
      .with({ kind: "scalar-call" }, (node) =>
        scalarCall(
          node.func,
          node.args.map((arg) => evaluateScalar(arg, row)),
        ),
      )
      .exhaustive()
  );
}

function arithmetic(
  op: "+" | "-" | "*" | "/" | "%",
  left: number | null,
  right: number | null,
): number | null {
  if (left === null || right === null) return null;
  return match(op)
    .with("+", () => left + right)
    .with("-", () => left - right)
    .with("*", () => left * right)
    .with("/", () => (right === 0 ? null : left / right))
    .with("%", () => (right === 0 ? null : left % right))
    .exhaustive();
}

/**
 * DuckDB's numeric-to-integer conversions — `CAST(x AS INTEGER)` and
 * `ROUND(x, n)` alike — round half away from zero (`1.5`→2, `-1.5`→-2,
 * `2.5`→3), confirmed against a real DuckDB instance. `Math.round` is NOT
 * this: it rounds ties toward +Infinity, so `Math.round(-1.5)` is `-1`, one
 * off from DuckDB's `-2`. Truncation (`Math.trunc`) is off in the other
 * direction for every non-integer input. A folded `player_groups` row and a
 * lake row must agree on this or `AVG(kda::INT)` reports a different number
 * depending on which engine happened to answer the query.
 */
function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

function cast(
  to: "int" | "bigint" | "double" | "date" | "timestamp" | "varchar",
  value: LakeScalar,
): LakeScalar {
  if (value === null) return null;
  return match(to)
    .with("int", "bigint", () => {
      const numeric = asNumber(value, "CAST");
      return numeric === null ? null : roundHalfAwayFromZero(numeric);
    })
    .with("double", () => asNumber(value, "CAST"))
    .with("varchar", () => String(value))
    .with("date", "timestamp", () => unsupported("CAST to a temporal type"))
    .exhaustive();
}

const SCALAR_ARITY_ERROR = "takes at least one argument";

function scalarCall(
  func:
    | "round"
    | "floor"
    | "ceil"
    | "abs"
    | "coalesce"
    | "nullif"
    | "greatest"
    | "least"
    | "date_trunc",
  args: LakeScalar[],
): LakeScalar {
  return match(func)
    .with("coalesce", () => args.find((value) => value !== null) ?? null)
    .with("nullif", () => {
      const [value, sentinel] = args;
      if (value === undefined || sentinel === undefined) {
        throw new Error(`NULLIF ${SCALAR_ARITY_ERROR}s two arguments.`);
      }
      return value === sentinel ? null : value;
    })
    .with("greatest", () => extremum(args, 1))
    .with("least", () => extremum(args, -1))
    .with("date_trunc", () => unsupported("DATE_TRUNC"))
    .with("round", () => {
      const [value, digits] = args;
      const numeric = asNumber(value ?? null, "ROUND");
      if (numeric === null) return null;
      const precision = digits === undefined ? 0 : asNumber(digits, "ROUND");
      if (
        precision === null ||
        !Number.isInteger(precision) ||
        precision < 0 ||
        precision > 10
      ) {
        throw new Error("ROUND precision must be an integer from 0 to 10.");
      }
      const scale = 10 ** precision;
      return roundHalfAwayFromZero(numeric * scale) / scale;
    })
    .with("floor", "ceil", "abs", (name) => {
      const numeric = asNumber(args[0] ?? null, name.toUpperCase());
      if (numeric === null) return null;
      return match(name)
        .with("floor", () => Math.floor(numeric))
        .with("ceil", () => Math.ceil(numeric))
        .with("abs", () => Math.abs(numeric))
        .exhaustive();
    })
    .exhaustive();
}

function extremum(args: LakeScalar[], direction: 1 | -1): LakeScalar {
  const present = args.filter((value) => value !== null);
  if (present.length === 0) return null;
  return present.reduce((best, candidate) =>
    compareScalars(candidate, best) * direction > 0 ? candidate : best,
  );
}

function compareScalars(left: LakeScalar, right: LakeScalar): number {
  if (typeof left === "string" || typeof right === "string") {
    return String(left).localeCompare(String(right));
  }
  const leftNumber = asNumber(left, "Comparison") ?? 0;
  const rightNumber = asNumber(right, "Comparison") ?? 0;
  return leftNumber - rightNumber;
}

// ── Predicates (WHERE-shaped, used by FILTER) ────────────────────────────────

function assertFilterable(
  predicate: ScoutQlPredicate,
  ctx: AggregateEvalContext,
): void {
  const referenced = new Set<string>();
  collectPredicateColumnNames(predicate, referenced);
  for (const name of referenced) {
    if (!ctx.filterableColumns.has(name)) {
      throw new Error(
        `FILTER (WHERE …) on a teammate-group query may only reference game-level columns; "${name}" is summed across the group's members, so it has no per-game truth value.`,
      );
    }
  }
}

/**
 * Three-valued, as SQL is: NULL propagates rather than collapsing to false. A
 * FILTER keeps only rows that answer TRUE, so `WHERE queue = 'solo'` still
 * excludes a NULL queue — but `(placement <= 2)::INT` then reads NULL rather
 * than 0, which is what keeps a conditional rate's denominator honest.
 */
export function evaluatePredicate(
  predicate: ScoutQlPredicate,
  row: FactRow,
): boolean | null {
  return match(predicate)
    .with({ kind: "and" }, { kind: "or" }, (node) =>
      combine(
        node.operands.map((operand) => evaluatePredicate(operand, row)),
        node.kind,
      ),
    )
    .with({ kind: "not" }, (node) => {
      const value = evaluatePredicate(node.operand, row);
      return value === null ? null : !value;
    })
    .with({ kind: "compare" }, (node) =>
      comparePredicate(
        node.op,
        evaluateScalar(node.left, row),
        evaluateScalar(node.right, row),
      ),
    )
    .with({ kind: "in" }, (node) => {
      const value = evaluateScalar(node.operand, row);
      if (value === null) return null;
      const contains = node.items.some(
        (item) => compareScalars(item, value) === 0,
      );
      return node.negated ? !contains : contains;
    })
    .with({ kind: "between" }, (node) => {
      const value = evaluateScalar(node.operand, row);
      const low = evaluateScalar(node.low, row);
      const high = evaluateScalar(node.high, row);
      if (value === null || low === null || high === null) return null;
      const inside =
        compareScalars(value, low) >= 0 && compareScalars(value, high) <= 0;
      return node.negated ? !inside : inside;
    })
    .with({ kind: "is-null" }, (node) => {
      const isNull = evaluateScalar(node.operand, row) === null;
      return node.negated ? !isNull : isNull;
    })
    .with({ kind: "player-ref" }, () =>
      unsupported("player('…') on player_groups"),
    )
    .exhaustive();
}

function combine(values: (boolean | null)[], op: "and" | "or"): boolean | null {
  const dominant = op === "or";
  if (values.includes(dominant)) return dominant;
  return values.includes(null) ? null : !dominant;
}

function comparePredicate(
  op: "=" | "!=" | "<" | "<=" | ">" | ">=" | "like" | "ilike",
  left: LakeScalar,
  right: LakeScalar,
): boolean | null {
  if (left === null || right === null) return null;
  if (op === "like" || op === "ilike") {
    return likeMatches(String(left), String(right), op === "ilike");
  }
  const ordering = compareScalars(left, right);
  return match(op)
    .with("=", () => ordering === 0)
    .with("!=", () => ordering !== 0)
    .with("<", () => ordering < 0)
    .with("<=", () => ordering <= 0)
    .with(">", () => ordering > 0)
    .with(">=", () => ordering >= 0)
    .exhaustive();
}

/** SQL LIKE: `%` any run, `_` one character; everything else is literal. */
function likeMatches(
  value: string,
  pattern: string,
  caseInsensitive: boolean,
): boolean {
  const folded = caseInsensitive ? pattern.toLowerCase() : pattern;
  const source = folded.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const expression = new RegExp(
    `^${source.replaceAll("%", ".*").replaceAll("_", ".")}$`,
    "su",
  );
  return expression.test(caseInsensitive ? value.toLowerCase() : value);
}

// ── Aggregates ───────────────────────────────────────────────────────────────

function filteredRows(
  filter: ScoutQlPredicate | undefined,
  ctx: AggregateEvalContext,
): readonly FactRow[] {
  if (filter === undefined) return ctx.rows;
  assertFilterable(filter, ctx);
  return ctx.rows.filter((row) => evaluatePredicate(filter, row) === true);
}

function numericValues(
  arg: ScoutQlScalarExpr,
  rows: readonly FactRow[],
  what: string,
): number[] {
  return rows.flatMap((row) => {
    const value = asNumber(evaluateScalar(arg, row), what);
    return value === null ? [] : [value];
  });
}

export function evaluateAggregate(
  expr: ScoutQlAggregateExpr,
  ctx: AggregateEvalContext,
): LakeScalar {
  return match(expr)
    .with(
      { kind: "count-star" },
      (node) => filteredRows(node.filter, ctx).length,
    )
    .with({ kind: "aggregate" }, (node) => {
      const rows = filteredRows(node.filter, ctx);
      if (node.distinct) {
        throw new Error(
          "COUNT(DISTINCT …) is not supported by the JS aggregate evaluator: player_groups rows are already-folded member rows and rank-source rows are already-folded leaderboard entries, so the distinct values behind either are gone by the time they reach this evaluator.",
        );
      }
      if (node.func === "count") {
        return rows.filter((row) => evaluateScalar(node.arg, row) !== null)
          .length;
      }
      if (node.func === "min" || node.func === "max") {
        return extremum(
          rows.map((row) => evaluateScalar(node.arg, row)),
          node.func === "max" ? 1 : -1,
        );
      }
      const values = numericValues(node.arg, rows, node.func.toUpperCase());
      return match(node.func)
        .with("sum", () =>
          values.length === 0
            ? null
            : values.reduce((total, value) => total + value, 0),
        )
        .with("avg", () => mean(values))
        .with("median", () => quantileCont(values, 0.5))
        .with("stddev", () => sampleStddev(values))
        .exhaustive();
    })
    .with({ kind: "quantile" }, (node) =>
      quantileCont(
        numericValues(
          node.arg,
          filteredRows(node.filter, ctx),
          "QUANTILE_CONT",
        ),
        node.q,
      ),
    )
    .with({ kind: "literal" }, (node) => node.value)
    .with({ kind: "arithmetic" }, (node) =>
      arithmetic(
        node.op,
        asNumber(evaluateAggregate(node.left, ctx), "Arithmetic"),
        asNumber(evaluateAggregate(node.right, ctx), "Arithmetic"),
      ),
    )
    .with({ kind: "scalar-call" }, (node) =>
      scalarCall(
        node.func,
        node.args.map((arg) => evaluateAggregate(arg, ctx)),
      ),
    )
    .with({ kind: "output-ref" }, (node) => {
      if (!ctx.outputs.has(node.name)) {
        throw new Error(
          `Output "${node.name}" is referenced before it is computed.`,
        );
      }
      return ctx.outputs.get(node.name) ?? null;
    })
    .exhaustive();
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Sample standard deviation, as DuckDB's STDDEV: NULL below two values. */
function sampleStddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values) ?? 0;
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

/** QUANTILE_CONT: linear interpolation between the two neighbouring values. */
function quantileCont(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const position = q * (sorted.length - 1);
  const lower = sorted[Math.floor(position)];
  const upper = sorted[Math.ceil(position)];
  if (lower === undefined || upper === undefined) {
    throw new Error("unreachable: quantile position outside the sample");
  }
  return lower + (upper - lower) * (position - Math.floor(position));
}

export function evaluateHaving(
  predicate: ScoutQlHavingPredicate,
  ctx: AggregateEvalContext,
): boolean {
  return match(predicate)
    .with({ kind: "and" }, (node) =>
      node.operands.every((operand) => evaluateHaving(operand, ctx)),
    )
    .with({ kind: "or" }, (node) =>
      node.operands.some((operand) => evaluateHaving(operand, ctx)),
    )
    .with({ kind: "not" }, (node) => !evaluateHaving(node.operand, ctx))
    .with(
      { kind: "compare" },
      (node) =>
        comparePredicate(
          node.op,
          evaluateAggregate(node.left, ctx),
          evaluateAggregate(node.right, ctx),
        ) === true,
    )
    .exhaustive();
}
