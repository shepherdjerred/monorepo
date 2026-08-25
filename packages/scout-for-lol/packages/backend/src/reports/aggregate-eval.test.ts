import { describe, expect, test } from "vitest";
import type { ScoutQlScalarExpr } from "@scout-for-lol/data/model/scoutql/expression.ts";
import { evaluateScalar, type FactRow } from "#src/reports/aggregate-eval.ts";

/**
 * DuckDB's numeric-to-integer conversions round half away from zero, verified
 * against a live DuckDB instance: `CAST(1.5 AS INTEGER)` is 2,
 * `CAST(2.5 AS INTEGER)` is 3, and — the asymmetric case that distinguishes
 * this from JS's own `Math.round` — `CAST(-1.5 AS INTEGER)` is -2, not -1.
 * `Math.round` rounds ties toward +Infinity, so it silently disagrees with
 * DuckDB on every negative half-integer. player_groups rows are folded in JS
 * (aggregate-eval.ts) instead of SQL, so these have to match exactly or
 * `AVG(kda::INT)` reports a different number depending on which engine
 * happened to answer the query.
 */

const EMPTY_ROW: FactRow = new Map();

function castToInt(value: number): ScoutQlScalarExpr {
  return { kind: "cast", to: "int", operand: { kind: "literal", value } };
}

describe("CAST(… AS INT) matches DuckDB's round-half-away-from-zero", () => {
  test.each([
    [1.5, 2],
    [2.5, 3],
    [-1.5, -2],
    [-2.5, -3],
    [0.5, 1],
    [-0.5, -1],
    [1.9, 2],
    [-1.9, -2],
    [1.4, 1],
    [-1.4, -1],
  ])("CAST(%s AS INT) = %i", (input, expected) => {
    expect(evaluateScalar(castToInt(input), EMPTY_ROW)).toBe(expected);
  });
});
