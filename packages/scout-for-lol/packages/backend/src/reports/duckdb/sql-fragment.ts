import { match } from "ts-pattern";
import type { ScoutQlScalarFunction } from "@scout-for-lol/data/model/scoutql/expression.ts";
import { scalarParam } from "#src/reports/duckdb/lake.ts";
import type { BoundParam, SqlFragment } from "#src/reports/duckdb/lake.ts";

/**
 * Combinators over lake.ts's SqlFragment/BoundParam pair.
 *
 * The injection-safety model of the plan compiler is structural: SQL text and
 * its bound parameters always travel together in one fragment, and fragments
 * are only ever assembled through these combinators. A parameter can therefore
 * never desync from the `?` that consumes it, and no runtime value can reach
 * SQL text — the only strings that become SQL are literals written in the
 * compiler modules themselves plus column names from the closed lake-schema
 * maps.
 */

export const EMPTY_FRAGMENT: SqlFragment = { sql: "", params: [] };

/** A fragment from compiler-owned SQL text plus the params its `?`s consume. */
export function frag(sql: string, params: BoundParam[] = []): SqlFragment {
  return { sql, params };
}

/**
 * Concatenate parts in order. Plain strings are compiler-owned SQL text;
 * fragments contribute their text and parameters in place, which is what keeps
 * positional `?` binding correct no matter how deeply fragments nest.
 */
export function seq(...parts: (string | SqlFragment)[]): SqlFragment {
  const sql: string[] = [];
  const params: BoundParam[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      sql.push(part);
      continue;
    }
    sql.push(part.sql);
    params.push(...part.params);
  }
  return { sql: sql.join(""), params };
}

/** Join non-empty fragments with a compiler-owned separator. */
export function joinFragments(
  fragments: SqlFragment[],
  separator: string,
): SqlFragment {
  const nonEmpty = fragments.filter((fragment) => fragment.sql.length > 0);
  return {
    sql: nonEmpty.map((fragment) => fragment.sql).join(separator),
    params: nonEmpty.flatMap((fragment) => fragment.params),
  };
}

export function parenthesize(fragment: SqlFragment): SqlFragment {
  return { sql: `(${fragment.sql})`, params: fragment.params };
}

/** AND-join non-empty predicate fragments, parenthesizing each conjunct. */
export function combineAnd(fragments: SqlFragment[]): SqlFragment {
  const nonEmpty = fragments.filter((fragment) => fragment.sql.length > 0);
  if (nonEmpty.length === 0) {
    return EMPTY_FRAGMENT;
  }
  if (nonEmpty.length === 1) {
    const only = nonEmpty[0];
    if (only === undefined) {
      throw new Error("unreachable: non-empty fragment list has no head");
    }
    return only;
  }
  return joinFragments(
    nonEmpty.map((fragment) => parenthesize(fragment)),
    " AND ",
  );
}

// ── Shared emitters (scalar and aggregate expression trees) ─────────────────

export type ScalarCallArg = {
  fragment: SqlFragment;
  /** Set when the IR argument is a literal node (arity-shape validation). */
  literal: number | string | boolean | undefined;
};

const DATE_TRUNC_PARTS: ReadonlySet<string> = new Set([
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "quarter",
  "year",
]);

function requireArity(
  func: ScoutQlScalarFunction,
  args: ScalarCallArg[],
  minimum: number,
  maximum: number,
): void {
  if (args.length < minimum || args.length > maximum) {
    throw new Error(
      `${func}() takes ${minimum.toString()}–${maximum.toString()} arguments, got ${args.length.toString()}.`,
    );
  }
}

function callWithArgs(name: string, args: ScalarCallArg[]): SqlFragment {
  return seq(
    `${name}(`,
    joinFragments(
      args.map((arg) => seq("(", arg.fragment, ")")),
      ", ",
    ),
    ")",
  );
}

/**
 * Shared scalar-call emitter for both scalar and aggregate expression trees.
 * Function names come from the exhaustive match over the closed enum, never
 * from the plan.
 */
export function emitScalarCall(
  func: ScoutQlScalarFunction,
  args: ScalarCallArg[],
): SqlFragment {
  return match(func)
    .with("floor", "ceil", "abs", (name) => {
      requireArity(func, args, 1, 1);
      return callWithArgs(name, args);
    })
    .with("round", () => {
      requireArity(func, args, 1, 2);
      const [value, digits] = args;
      if (value === undefined) {
        throw new Error("round() requires an argument.");
      }
      if (digits === undefined) {
        return callWithArgs("round", [value]);
      }
      if (
        typeof digits.literal !== "number" ||
        !Number.isInteger(digits.literal)
      ) {
        throw new TypeError("round() digit count must be an integer literal.");
      }
      return seq(
        "round((",
        value.fragment,
        "), ?::INTEGER)",
        frag("", [scalarParam(digits.literal)]),
      );
    })
    .with("coalesce", () => {
      requireArity(func, args, 1, 8);
      return callWithArgs("coalesce", args);
    })
    .with("nullif", () => {
      requireArity(func, args, 2, 2);
      return callWithArgs("nullif", args);
    })
    .with("greatest", "least", (name) => {
      requireArity(func, args, 2, 8);
      return callWithArgs(name, args);
    })
    .with("date_trunc", () => {
      requireArity(func, args, 2, 2);
      const [part, operand] = args;
      if (part === undefined || operand === undefined) {
        throw new Error("date_trunc() requires a part and an operand.");
      }
      if (
        typeof part.literal !== "string" ||
        !DATE_TRUNC_PARTS.has(part.literal)
      ) {
        throw new TypeError(
          "date_trunc() part must be a literal like 'day', 'week', or 'month'.",
        );
      }
      return seq(
        "date_trunc(?, (",
        frag("", [scalarParam(part.literal)]),
        operand.fragment,
        "))",
      );
    })
    .exhaustive();
}

/** Shared arithmetic emitter for scalar and aggregate expression trees. */
export function emitArithmetic(
  op: "+" | "-" | "*" | "/" | "%",
  left: SqlFragment,
  right: SqlFragment,
): SqlFragment {
  // DuckDB `/` is float division. NULLIF keeps a zero denominator an empty
  // answer instead of a crashed report; same for `%`.
  if (op === "/" || op === "%") {
    return seq("((", left, `) ${op} nullif((`, right, "), 0))");
  }
  return seq("((", left, `) ${op} (`, right, "))");
}
