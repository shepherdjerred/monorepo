import { describe, expect, test } from "vitest";
import {
  collapsedSpan,
  flattenAnd,
  sameExpr,
  unionSpan,
  type ScoutQlExprAst,
} from "#src/model/scoutql/ast.ts";
import { parseScoutQl } from "#src/model/scoutql/parse.ts";

function whereExprOf(text: string): ScoutQlExprAst {
  const result = parseScoutQl(text);
  expect(result.diagnostics).toEqual([]);
  const where = result.ast.where;
  if (where === undefined) {
    throw new Error(`query has no WHERE clause: ${text}`);
  }
  return where.expr;
}

function firstSelectExprOf(text: string): ScoutQlExprAst {
  const result = parseScoutQl(text);
  expect(result.diagnostics).toEqual([]);
  const item = result.ast.select?.items[0];
  if (item === undefined) {
    throw new Error(`query has no select item: ${text}`);
  }
  return item.expr;
}

describe("span helpers", () => {
  test("unionSpan covers both inputs", () => {
    expect(unionSpan({ start: 4, end: 9 }, { start: 2, end: 6 })).toEqual({
      start: 2,
      end: 9,
    });
  });

  test("collapsedSpan is zero-length at the offset", () => {
    expect(collapsedSpan(7)).toEqual({ start: 7, end: 7 });
  });
});

describe("flattenAnd", () => {
  test("flattens a nested AND chain into its conjuncts", () => {
    const expr = whereExprOf(
      "SELECT COUNT(*) AS g FROM t WHERE a = 1 AND b = 2 AND c = 3",
    );
    const conjuncts = flattenAnd(expr);
    expect(conjuncts).toHaveLength(3);
    for (const conjunct of conjuncts) {
      expect(conjunct.kind).toBe("binary");
    }
  });

  test("does not flatten through OR or NOT", () => {
    const orExpr = whereExprOf(
      "SELECT COUNT(*) AS g FROM t WHERE a = 1 OR b = 2",
    );
    expect(flattenAnd(orExpr)).toHaveLength(1);
    const notExpr = whereExprOf(
      "SELECT COUNT(*) AS g FROM t WHERE NOT (a = 1 AND b = 2)",
    );
    expect(flattenAnd(notExpr)).toHaveLength(1);
  });

  test("a non-AND expression is a single conjunct", () => {
    const expr = whereExprOf("SELECT COUNT(*) AS g FROM t WHERE win");
    expect(flattenAnd(expr)).toEqual([expr]);
  });
});

describe("sameExpr", () => {
  test("ignores spans", () => {
    const a = firstSelectExprOf("SELECT kills + deaths AS x FROM t");
    const b = firstSelectExprOf("SELECT   kills + deaths   AS x FROM t");
    expect(a).not.toEqual(b); // spans differ
    expect(sameExpr(a, b)).toBe(true);
  });

  test("normalizes :: and CAST(… AS …) to the same cast", () => {
    const operatorForm = firstSelectExprOf("SELECT win::INT AS w FROM t");
    const functionForm = firstSelectExprOf(
      "SELECT CAST(win AS INT) AS w FROM t",
    );
    expect(sameExpr(operatorForm, functionForm)).toBe(true);
  });

  test("normalizes INTERVAL forms with the same unit", () => {
    const numberForm = firstSelectExprOf("SELECT INTERVAL 30 day AS i FROM t");
    const stringForm = firstSelectExprOf(
      "SELECT INTERVAL '30 day' AS i FROM t",
    );
    expect(sameExpr(numberForm, stringForm)).toBe(true);
  });

  test("matches a SELECT expression against its GROUP BY twin", () => {
    const result = parseScoutQl(
      "SELECT DATE_TRUNC('week', t) AS week, COUNT(*) AS g FROM m GROUP BY DATE_TRUNC('week', t)",
    );
    expect(result.diagnostics).toEqual([]);
    const selectExpr = result.ast.select?.items[0]?.expr;
    const groupingExpr = result.ast.groupBy?.items[0];
    if (selectExpr === undefined || groupingExpr === undefined) {
      throw new Error("expected select item and grouping");
    }
    expect(sameExpr(selectExpr, groupingExpr)).toBe(true);
  });

  test("distinguishes different expressions", () => {
    const a = firstSelectExprOf("SELECT SUM(kills) AS x FROM t");
    const b = firstSelectExprOf("SELECT SUM(deaths) AS x FROM t");
    expect(sameExpr(a, b)).toBe(false);
    const c = firstSelectExprOf("SELECT COUNT(DISTINCT champion) AS x FROM t");
    const d = firstSelectExprOf("SELECT COUNT(champion) AS x FROM t");
    expect(sameExpr(c, d)).toBe(false);
  });

  test("distinguishes filters on calls", () => {
    const plain = firstSelectExprOf("SELECT COUNT(*) AS x FROM t");
    const filtered = firstSelectExprOf(
      "SELECT COUNT(*) FILTER (WHERE win) AS x FROM t",
    );
    expect(sameExpr(plain, filtered)).toBe(false);
  });

  test("error nodes compare equal to nothing, including themselves", () => {
    const error: ScoutQlExprAst = { kind: "error", span: { start: 0, end: 0 } };
    expect(sameExpr(error, error)).toBe(false);
    const containing: ScoutQlExprAst = {
      kind: "unary",
      op: "not",
      operand: error,
      span: { start: 0, end: 0 },
    };
    expect(sameExpr(containing, containing)).toBe(false);
  });
});
