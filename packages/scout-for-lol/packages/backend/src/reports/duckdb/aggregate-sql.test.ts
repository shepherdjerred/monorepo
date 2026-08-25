import { describe, expect, test } from "vitest";
import type {
  ScoutQlAggregateExpr,
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/expression.ts";
import {
  collectAggregateColumnNames,
  compileAggregateExpr,
  compileHavingPredicate,
  countAggregateNodes,
  countHavingNodes,
  inferScalarType,
  type AggregateContext,
} from "#src/reports/duckdb/aggregate-sql.ts";
import { buildPlanColumnMap } from "#src/reports/duckdb/expr-sql.ts";
import { frag } from "#src/reports/duckdb/sql-fragment.ts";
import { paramValues } from "#src/testing/test-lake-files.ts";

const MATCH_COLUMNS = buildPlanColumnMap("match");

function ctx(overrides: Partial<AggregateContext> = {}): AggregateContext {
  return {
    columns: MATCH_COLUMNS,
    playerPuuids: undefined,
    resolveOutputRef: (name) => {
      throw new Error(`unexpected output-ref ${name}`);
    },
    ...overrides,
  };
}

function col(column: string): ScoutQlScalarExpr {
  return { kind: "column", column };
}

function soloFilter(): ScoutQlPredicate {
  return {
    kind: "compare",
    op: "=",
    left: col("queue"),
    right: { kind: "literal", value: "solo" },
  };
}

describe("aggregate compilation", () => {
  test("COUNT(*) with FILTER casts BIGINT around the whole aggregate", () => {
    const compiled = compileAggregateExpr(
      { kind: "count-star", filter: soloFilter() },
      ctx(),
    );
    expect(compiled.sql).toBe(
      "(COUNT(*) FILTER (WHERE ((queue) = (?))))::BIGINT",
    );
    expect(paramValues(compiled.params)).toEqual(["solo"]);
  });

  test("COUNT DISTINCT compiles; DISTINCT outside COUNT throws", () => {
    const compiled = compileAggregateExpr(
      {
        kind: "aggregate",
        func: "count",
        arg: col("champion_name"),
        distinct: true,
      },
      ctx(),
    );
    expect(compiled.sql).toBe("(COUNT(DISTINCT (champion_name)))::BIGINT");
    expect(() =>
      compileAggregateExpr(
        { kind: "aggregate", func: "sum", arg: col("kills"), distinct: true },
        ctx(),
      ),
    ).toThrow(/DISTINCT is only supported for COUNT/);
  });

  test("SUM/AVG/STDDEV always cast DOUBLE", () => {
    for (const func of ["sum", "avg", "stddev"] as const) {
      const compiled = compileAggregateExpr(
        { kind: "aggregate", func, arg: col("kills"), distinct: false },
        ctx(),
      );
      expect(compiled.sql).toBe(`(${func.toUpperCase()}((kills)))::DOUBLE`);
    }
  });

  test("MIN/MAX/MEDIAN cast DOUBLE only for numeric arguments", () => {
    expect(
      compileAggregateExpr(
        { kind: "aggregate", func: "min", arg: col("kills"), distinct: false },
        ctx(),
      ).sql,
    ).toBe("(MIN((kills)))::DOUBLE");
    // A text argument keeps its own type — casting would fail at runtime.
    expect(
      compileAggregateExpr(
        { kind: "aggregate", func: "min", arg: col("queue"), distinct: false },
        ctx(),
      ).sql,
    ).toBe("(MIN((queue)))");
    expect(
      compileAggregateExpr(
        {
          kind: "aggregate",
          func: "max",
          arg: col("game_creation_at"),
          distinct: false,
        },
        ctx(),
      ).sql,
    ).toBe("(MAX((game_creation_at)))");
  });

  test("QUANTILE_CONT binds the fraction and validates its range", () => {
    const compiled = compileAggregateExpr(
      { kind: "quantile", arg: col("kills"), q: 0.9, filter: soloFilter() },
      ctx(),
    );
    expect(compiled.sql).toBe(
      "(QUANTILE_CONT((kills), ?) FILTER (WHERE ((queue) = (?))))::DOUBLE",
    );
    expect(paramValues(compiled.params)).toEqual([0.9, "solo"]);
    expect(() =>
      compileAggregateExpr(
        { kind: "quantile", arg: col("kills"), q: 1 },
        ctx(),
      ),
    ).toThrow(/between 0 and 1/);
  });

  test("division between aggregates guards the denominator", () => {
    const compiled = compileAggregateExpr(
      {
        kind: "arithmetic",
        op: "/",
        left: {
          kind: "aggregate",
          func: "sum",
          arg: col("kills"),
          distinct: false,
        },
        right: { kind: "count-star" },
      },
      ctx(),
    );
    expect(compiled.sql).toBe(
      "(((SUM((kills)))::DOUBLE) / nullif(((COUNT(*))::BIGINT), 0))",
    );
  });

  test("aggregate literals bind as DOUBLE parameters", () => {
    const compiled = compileAggregateExpr(
      { kind: "literal", value: 60 },
      ctx(),
    );
    expect(compiled.sql).toBe("(?::DOUBLE)");
    expect(paramValues(compiled.params)).toEqual([60]);
  });

  test("output-ref goes through the caller's resolver", () => {
    expect(() =>
      compileAggregateExpr({ kind: "output-ref", name: "games" }, ctx()),
    ).toThrow(/unexpected output-ref games/);
    const compiled = compileAggregateExpr(
      { kind: "output-ref", name: "games" },
      ctx({ resolveOutputRef: () => frag("expr_2") }),
    );
    expect(compiled.sql).toBe("expr_2");
  });
});

describe("HAVING compilation", () => {
  test("boolean trees over aggregates with alias resolution", () => {
    const having = compileHavingPredicate(
      {
        kind: "and",
        operands: [
          {
            kind: "compare",
            op: ">=",
            left: { kind: "output-ref", name: "games" },
            right: { kind: "literal", value: 5 },
          },
          {
            kind: "not",
            operand: {
              kind: "compare",
              op: "<",
              left: { kind: "count-star" },
              right: { kind: "literal", value: 2 },
            },
          },
        ],
      },
      ctx({ resolveOutputRef: () => frag("expr_0") }),
    );
    expect(having.sql).toBe(
      "(((expr_0) >= ((?::DOUBLE))) AND (NOT (((COUNT(*))::BIGINT) < ((?::DOUBLE)))))",
    );
    expect(paramValues(having.params)).toEqual([5, 2]);
  });
});

describe("walk-derived helpers", () => {
  test("column collection descends into args and filters", () => {
    const referenced = new Set<string>();
    const expr: ScoutQlAggregateExpr = {
      kind: "aggregate",
      func: "avg",
      arg: { kind: "cast", to: "int", operand: col("win") },
      distinct: false,
      filter: {
        kind: "and",
        operands: [soloFilter(), { kind: "player-ref", index: 0 }],
      },
    };
    collectAggregateColumnNames(expr, referenced);
    expect([...referenced].toSorted()).toEqual(["puuid", "queue", "win"]);
  });

  test("node counting covers aggregates and having trees", () => {
    expect(countAggregateNodes({ kind: "count-star" })).toBe(1);
    expect(
      countAggregateNodes({
        kind: "aggregate",
        func: "sum",
        arg: col("kills"),
        distinct: false,
        filter: soloFilter(),
      }),
    ).toBe(5);
    expect(
      countHavingNodes({
        kind: "compare",
        op: ">",
        left: { kind: "count-star" },
        right: { kind: "literal", value: 1 },
      }),
    ).toBe(3);
  });

  test("inferScalarType drives cast decisions", () => {
    expect(inferScalarType(col("kills"), MATCH_COLUMNS)).toBe("numeric");
    expect(inferScalarType(col("queue"), MATCH_COLUMNS)).toBe("text");
    expect(inferScalarType(col("game_creation_at"), MATCH_COLUMNS)).toBe(
      "timestamp",
    );
    expect(
      inferScalarType(
        { kind: "cast", to: "int", operand: col("win") },
        MATCH_COLUMNS,
      ),
    ).toBe("numeric");
    expect(
      inferScalarType(
        {
          kind: "arithmetic",
          op: "-",
          left: { kind: "now", which: "timestamp" },
          right: { kind: "interval", amount: 30, unit: "day" },
        },
        MATCH_COLUMNS,
      ),
    ).toBe("timestamp");
    expect(
      inferScalarType(
        {
          kind: "scalar-call",
          func: "coalesce",
          args: [col("queue"), { kind: "literal", value: "unknown" }],
        },
        MATCH_COLUMNS,
      ),
    ).toBe("text");
  });
});
