import { describe, expect, test } from "vitest";
import type {
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/expression.ts";
import {
  buildPlanColumnMap,
  compilePredicate,
  compileScalarExpr,
  countPredicateNodes,
  countScalarNodes,
  predicateTouchesIdentity,
  resolveColumn,
  type ExprContext,
} from "#src/reports/duckdb/expr-sql.ts";
import { scalarParam } from "#src/reports/duckdb/lake.ts";
import {
  combineAnd,
  frag,
  joinFragments,
  parenthesize,
  seq,
} from "#src/reports/duckdb/sql-fragment.ts";
import { paramValues } from "#src/testing/test-lake-files.ts";

const MATCH_COLUMNS = buildPlanColumnMap("match");
const PREMATCH_COLUMNS = buildPlanColumnMap("prematch");

function factsCtx(overrides: Partial<ExprContext> = {}): ExprContext {
  return {
    columns: MATCH_COLUMNS,
    placement: "facts",
    playerPuuids: undefined,
    ...overrides,
  };
}

function col(column: string): ScoutQlScalarExpr {
  return { kind: "column", column };
}

function lit(value: number | string | boolean): ScoutQlScalarExpr {
  return { kind: "literal", value };
}

describe("sql-fragment combinators", () => {
  test("seq keeps SQL text and parameters aligned in order", () => {
    const combined = seq(
      "a = ",
      frag("?", [scalarParam(1)]),
      " AND b = ",
      frag("?", [scalarParam(2)]),
    );
    expect(combined.sql).toBe("a = ? AND b = ?");
    expect(paramValues(combined.params)).toEqual([1, 2]);
  });

  test("joinFragments drops empty fragments; parenthesize wraps; combineAnd conjoins", () => {
    const joined = joinFragments(
      [frag("x"), frag(""), frag("?", [scalarParam(3)])],
      ", ",
    );
    expect(joined.sql).toBe("x, ?");
    expect(parenthesize(frag("y")).sql).toBe("(y)");
    const conjoined = combineAnd([frag("a = 1"), frag(""), frag("b = 2")]);
    expect(conjoined.sql).toBe("(a = 1) AND (b = 2)");
    expect(combineAnd([frag("only")]).sql).toBe("only");
    expect(combineAnd([]).sql).toBe("");
  });
});

describe("column resolution", () => {
  test("known source columns compile to their bare names", () => {
    expect(compileScalarExpr(col("kills"), factsCtx()).sql).toBe("kills");
    expect(compileScalarExpr(col("queue"), factsCtx()).sql).toBe("queue");
  });

  test("virtual columns compile to their closed expressions", () => {
    expect(compileScalarExpr(col("patch"), factsCtx()).sql).toBe(
      String.raw`regexp_extract(game_version, '^[0-9]+\.[0-9]+')`,
    );
    expect(compileScalarExpr(col("outcome"), factsCtx()).sql).toBe(
      "CASE WHEN win THEN 'Win' ELSE 'Loss' END",
    );
    expect(compileScalarExpr(col("champion"), factsCtx()).sql).toBe(
      "champion_name",
    );
    expect(
      compileScalarExpr(
        col("champion"),
        factsCtx({ columns: PREMATCH_COLUMNS }),
      ).sql,
    ).toBe("champion_id::VARCHAR");
  });

  test("unknown columns throw before any SQL exists", () => {
    expect(() => compileScalarExpr(col("no_such_column"), factsCtx())).toThrow(
      /Unknown column "no_such_column"/,
    );
    // Match-only virtuals do not exist for prematch.
    expect(() =>
      compileScalarExpr(
        col("outcome"),
        factsCtx({ columns: PREMATCH_COLUMNS }),
      ),
    ).toThrow(/Unknown column "outcome"/);
  });

  test("identity columns refuse source placement (pushdown)", () => {
    expect(() =>
      compileScalarExpr(col("player"), factsCtx({ placement: "source" })),
    ).toThrow(/identity column/);
    expect(compileScalarExpr(col("player"), factsCtx()).sql).toBe(
      "player_alias",
    );
  });
});

describe("literals and parameters", () => {
  test("every literal becomes a bound parameter", () => {
    const compiled = compileScalarExpr(lit("hostile' text"), factsCtx());
    expect(compiled.sql).toBe("?");
    expect(paramValues(compiled.params)).toEqual(["hostile' text"]);
  });

  test("interval compiles to a closed constructor with a bound amount", () => {
    const compiled = compileScalarExpr(
      { kind: "interval", amount: 30, unit: "day" },
      factsCtx(),
    );
    expect(compiled.sql).toBe("to_days(?::INTEGER)");
    expect(paramValues(compiled.params)).toEqual([30]);
  });

  test("now() is rendered session-timezone-independent", () => {
    expect(
      compileScalarExpr({ kind: "now", which: "timestamp" }, factsCtx()).sql,
    ).toBe("timezone('UTC', now())");
    expect(
      compileScalarExpr({ kind: "now", which: "date" }, factsCtx()).sql,
    ).toBe("CAST(timezone('UTC', now()) AS DATE)");
  });

  test("at-time-zone binds the zone and double-converts naive UTC", () => {
    const compiled = compileScalarExpr(
      {
        kind: "at-time-zone",
        operand: col("game_creation_at"),
        timezone: "America/Los_Angeles",
      },
      factsCtx(),
    );
    expect(compiled.sql).toBe(
      "timezone(?, timezone('UTC', (game_creation_at)))",
    );
    expect(paramValues(compiled.params)).toEqual(["America/Los_Angeles"]);
  });

  test("casts come from the closed cast map", () => {
    expect(
      compileScalarExpr(
        { kind: "cast", to: "int", operand: col("win") },
        factsCtx(),
      ).sql,
    ).toBe("((win))::INTEGER");
    expect(
      compileScalarExpr(
        { kind: "cast", to: "varchar", operand: lit(5) },
        factsCtx(),
      ).sql,
    ).toBe("((?))::VARCHAR");
  });
});

describe("arithmetic and scalar calls", () => {
  test("division and modulo guard the denominator with nullif", () => {
    const division = compileScalarExpr(
      { kind: "arithmetic", op: "/", left: col("kills"), right: col("deaths") },
      factsCtx(),
    );
    expect(division.sql).toBe("((kills) / nullif((deaths), 0))");
    const modulo = compileScalarExpr(
      { kind: "arithmetic", op: "%", left: col("kills"), right: lit(0) },
      factsCtx(),
    );
    expect(modulo.sql).toBe("((kills) % nullif((?), 0))");
  });

  test("round with digits requires an integer literal and binds it", () => {
    const compiled = compileScalarExpr(
      { kind: "scalar-call", func: "round", args: [col("kda"), lit(2)] },
      factsCtx(),
    );
    expect(compiled.sql).toBe("round((kda), ?::INTEGER)");
    expect(paramValues(compiled.params)).toEqual([2]);
    expect(() =>
      compileScalarExpr(
        {
          kind: "scalar-call",
          func: "round",
          args: [col("kda"), col("kills")],
        },
        factsCtx(),
      ),
    ).toThrow(/integer literal/);
  });

  test("date_trunc requires a literal part from the closed set and binds it", () => {
    const compiled = compileScalarExpr(
      {
        kind: "scalar-call",
        func: "date_trunc",
        args: [lit("week"), col("game_creation_at")],
      },
      factsCtx(),
    );
    expect(compiled.sql).toBe("date_trunc(?, (game_creation_at))");
    expect(paramValues(compiled.params)).toEqual(["week"]);
    expect(() =>
      compileScalarExpr(
        {
          kind: "scalar-call",
          func: "date_trunc",
          args: [lit("century'); DROP TABLE r;--"), col("game_creation_at")],
        },
        factsCtx(),
      ),
    ).toThrow(/part must be a literal/);
    expect(() =>
      compileScalarExpr(
        {
          kind: "scalar-call",
          func: "date_trunc",
          args: [col("queue"), col("game_creation_at")],
        },
        factsCtx(),
      ),
    ).toThrow(/part must be a literal/);
  });

  test("arity violations throw", () => {
    expect(() =>
      compileScalarExpr(
        { kind: "scalar-call", func: "floor", args: [lit(1), lit(2)] },
        factsCtx(),
      ),
    ).toThrow(/takes 1–1 arguments/);
    expect(() =>
      compileScalarExpr(
        { kind: "scalar-call", func: "nullif", args: [lit(1)] },
        factsCtx(),
      ),
    ).toThrow(/takes 2–2 arguments/);
  });
});

describe("predicates", () => {
  test("IN compiles via unnest with a bound list", () => {
    const compiled = compilePredicate(
      {
        kind: "in",
        operand: col("queue"),
        negated: false,
        items: ["solo", "flex"],
      },
      factsCtx(),
    );
    expect(compiled.sql).toBe("((queue) IN (SELECT unnest(?)))");
    expect(paramValues(compiled.params)).toEqual(["solo", "flex"]);
  });

  test("NOT IN and numeric lists", () => {
    const compiled = compilePredicate(
      {
        kind: "in",
        operand: col("champion_id"),
        negated: true,
        items: [1, 2, 3],
      },
      factsCtx(),
    );
    expect(compiled.sql).toBe("((champion_id) NOT IN (SELECT unnest(?)))");
    expect(paramValues(compiled.params)).toEqual([1, 2, 3]);
  });

  test("mixed-type and empty IN lists throw", () => {
    expect(() =>
      compilePredicate(
        {
          kind: "in",
          operand: col("queue"),
          negated: false,
          items: ["solo", 42],
        },
        factsCtx(),
      ),
    ).toThrow(/all strings or all numbers/);
    expect(() =>
      compilePredicate(
        { kind: "in", operand: col("queue"), negated: false, items: [] },
        factsCtx(),
      ),
    ).toThrow(/must not be empty/);
  });

  test("compare, between, is-null, not, or shapes", () => {
    const compare = compilePredicate(
      {
        kind: "compare",
        op: "ilike",
        left: col("queue"),
        right: lit("%solo%"),
      },
      factsCtx(),
    );
    expect(compare.sql).toBe("((queue) ILIKE (?))");
    const between = compilePredicate(
      {
        kind: "between",
        operand: col("kills"),
        negated: true,
        low: lit(1),
        high: lit(5),
      },
      factsCtx(),
    );
    expect(between.sql).toBe("((kills) NOT BETWEEN (?) AND (?))");
    expect(paramValues(between.params)).toEqual([1, 5]);
    const isNull = compilePredicate(
      { kind: "is-null", operand: col("placement"), negated: false },
      factsCtx(),
    );
    expect(isNull.sql).toBe("((placement) IS NULL)");
    const tree = compilePredicate(
      {
        kind: "or",
        operands: [
          { kind: "not", operand: isNullPredicate() },
          { kind: "compare", op: ">=", left: col("kills"), right: lit(10) },
        ],
      },
      factsCtx(),
    );
    expect(tree.sql).toBe("((NOT ((placement) IS NULL)) OR ((kills) >= (?)))");
  });

  test("player-ref requires resolved, non-empty PUUIDs and binds them", () => {
    const ref: ScoutQlPredicate = { kind: "player-ref", index: 0 };
    expect(() => compilePredicate(ref, factsCtx())).toThrow(
      /requires resolved PUUIDs/,
    );
    expect(() =>
      compilePredicate(ref, factsCtx({ playerPuuids: new Map([[0, []]]) })),
    ).toThrow(/resolved to no accounts/);
    expect(() =>
      compilePredicate(ref, factsCtx({ playerPuuids: new Map([[1, ["p"]]]) })),
    ).toThrow(/resolved to no accounts/);
    const compiled = compilePredicate(
      ref,
      factsCtx({ playerPuuids: new Map([[0, ["PUUID-A", "PUUID-B"]]]) }),
    );
    expect(compiled.sql).toBe("(puuid IN (SELECT unnest(?)))");
    expect(paramValues(compiled.params)).toEqual(["PUUID-A", "PUUID-B"]);
  });
});

function isNullPredicate(): ScoutQlPredicate {
  return { kind: "is-null", operand: col("placement"), negated: false };
}

describe("analysis helpers", () => {
  test("predicateTouchesIdentity flags identity anywhere in the tree", () => {
    const identityLeaf: ScoutQlPredicate = {
      kind: "compare",
      op: "=",
      left: col("player"),
      right: lit("someone"),
    };
    const sourceLeaf: ScoutQlPredicate = {
      kind: "compare",
      op: "=",
      left: col("queue"),
      right: lit("solo"),
    };
    expect(predicateTouchesIdentity(identityLeaf, MATCH_COLUMNS)).toBe(true);
    expect(predicateTouchesIdentity(sourceLeaf, MATCH_COLUMNS)).toBe(false);
    expect(
      predicateTouchesIdentity(
        { kind: "or", operands: [sourceLeaf, identityLeaf] },
        MATCH_COLUMNS,
      ),
    ).toBe(true);
    // player-ref counts as puuid, a source column — pushable.
    expect(
      predicateTouchesIdentity({ kind: "player-ref", index: 0 }, MATCH_COLUMNS),
    ).toBe(false);
  });

  test("node counting covers scalar and predicate trees", () => {
    expect(countScalarNodes(col("kills"))).toBe(1);
    expect(
      countScalarNodes({
        kind: "arithmetic",
        op: "+",
        left: col("kills"),
        right: { kind: "negate", operand: lit(1) },
      }),
    ).toBe(4);
    expect(
      countPredicateNodes({
        kind: "and",
        operands: [
          { kind: "compare", op: "=", left: col("win"), right: lit(true) },
          { kind: "player-ref", index: 0 },
        ],
      }),
    ).toBe(5);
  });

  test("resolveColumn exposes the closed binding shape", () => {
    const binding = resolveColumn(MATCH_COLUMNS, "patch");
    expect(binding.dependencies).toEqual(["game_version"]);
    expect(binding.identity).toBe(false);
    expect(resolveColumn(MATCH_COLUMNS, "player").identity).toBe(true);
  });
});
