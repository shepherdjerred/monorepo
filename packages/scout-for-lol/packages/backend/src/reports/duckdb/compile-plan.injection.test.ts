import { describe, expect, test } from "vitest";
import { DEFAULT_RENDER_SPEC } from "@scout-for-lol/data/model/reports/report.ts";
import {
  MATCH_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
} from "@scout-for-lol/data/model/reports/lake-columns.ts";
import type {
  ScoutQlAggregateExpr,
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/expression.ts";
import type {
  ScoutQlGrouping,
  ScoutQlOutput,
  ScoutQlPlan,
} from "@scout-for-lol/data/model/scoutql/plan.ts";
import {
  compileGroupFactsProjection,
  compileScoutQlPlanQuery,
  type CompiledPlanQuery,
  type PlanQueryInput,
} from "#src/reports/duckdb/compile-plan.ts";
import { GLOBAL_SCOPE, guildScope } from "#src/reports/duckdb/scope.ts";
import {
  TEST_GUILD_ID,
  TEST_LAKE_FILES,
  paramValues,
} from "#src/testing/test-lake-files.ts";

/**
 * Injection fuzz for the plan compiler.
 *
 * Two layers: hostile strings driven into EVERY literal position of a plan
 * (asserting the hostile text never reaches SQL and always round-trips
 * through bound parameters), and a seeded random plan walk whose emitted SQL
 * must decompose into a closed token vocabulary derived from the compiler's
 * own emitters — any leaked runtime string fails the allowlist.
 */

const HOSTILE_STRINGS = [
  "'); DROP TABLE reports;--",
  "' OR '1'='1",
  '"; DELETE FROM matches; --',
  String.raw`back\slash''quote`,
  "💥'); ATTACH DATABASE 'pwn';--",
  "line\nbreak'); SELECT 1;--",
];

function col(column: string): ScoutQlScalarExpr {
  return { kind: "column", column };
}

function lit(value: number | string | boolean): ScoutQlScalarExpr {
  return { kind: "literal", value };
}

function makePlan(overrides: Partial<ScoutQlPlan>): ScoutQlPlan {
  return {
    source: "match_participants",
    outputs: [
      {
        name: "games",
        expr: { kind: "count-star" },
        displayKind: "count",
        additive: true,
        evidence: { kind: "sample" },
      },
    ],
    timeWindow: { kind: "unbounded" },
    groupings: [],
    orderBy: [],
    limit: 25,
    playerRefs: [],
    render: DEFAULT_RENDER_SPEC,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PlanQueryInput>): PlanQueryInput {
  return {
    plan: makePlan({}),
    scope: guildScope(TEST_GUILD_ID),
    files: TEST_LAKE_FILES,
    range: {
      start: new Date(1_700_000_000_000),
      end: new Date(1_700_600_000_000),
    },
    limit: 25,
    ...overrides,
  };
}

function mustCompile(input: PlanQueryInput): CompiledPlanQuery {
  const compiled = compileScoutQlPlanQuery(input);
  if (compiled === undefined) {
    throw new Error("expected compiled query");
  }
  return compiled;
}

describe("hostile strings in every literal position", () => {
  test.each(HOSTILE_STRINGS)(
    "hostile %#: never reaches SQL text",
    (hostile) => {
      const where: ScoutQlPredicate = {
        kind: "and",
        operands: [
          { kind: "compare", op: "=", left: col("queue"), right: lit(hostile) },
          {
            kind: "in",
            operand: col("game_mode"),
            negated: false,
            items: [hostile, `${hostile}-2`],
          },
          {
            kind: "between",
            operand: col("champion_name"),
            negated: false,
            low: lit(hostile),
            high: lit(`${hostile}~`),
          },
          {
            kind: "compare",
            op: "like",
            left: col("game_version"),
            right: lit(`%${hostile}%`),
          },
          {
            kind: "compare",
            op: ">=",
            left: {
              kind: "at-time-zone",
              operand: col("game_creation_at"),
              timezone: hostile,
            },
            right: { kind: "now", which: "timestamp" },
          },
          { kind: "player-ref", index: 0 },
        ],
      };
      const outputs: ScoutQlOutput[] = [
        {
          // A hostile *name* must vanish too: aliases are positional.
          name: hostile,
          expr: {
            kind: "aggregate",
            func: "sum",
            arg: col("kills"),
            distinct: false,
            filter: {
              kind: "compare",
              op: "=",
              left: col("champion_name"),
              right: lit(hostile),
            },
          },
          displayKind: "count",
          additive: true,
          evidence: { kind: "sample" },
        },
      ];
      const groupings: ScoutQlGrouping[] = [
        {
          kind: "date-trunc",
          part: "week",
          column: "game_creation_at",
          timezone: hostile,
          name: "week",
        },
      ];
      const compiled = mustCompile(
        makeInput({
          plan: makePlan({
            where,
            outputs,
            groupings,
            playerRefs: ["hostile-player"],
          }),
          playerPuuids: new Map([[0, [hostile, `${hostile}-p2`]]]),
        }),
      );
      for (const sql of [compiled.aggregateSql, compiled.scannedSql]) {
        expect(sql).not.toContain(hostile);
        expect(sql).not.toContain("DROP TABLE");
        expect(sql).not.toContain("DELETE FROM");
        expect(sql).not.toContain("ATTACH DATABASE");
        expect(sql).not.toContain(";");
      }
      // Round-trip: every hostile literal survives as a bound parameter value.
      const values = paramValues(compiled.aggregateParams);
      const expectedBound = [
        hostile, // compare literal
        `${hostile}-2`, // IN item
        `${hostile}~`, // BETWEEN high
        `%${hostile}%`, // LIKE pattern
        `${hostile}-p2`, // player-ref PUUID
      ];
      for (const value of expectedBound) {
        expect(values).toContain(value);
      }
      // The timezone binds twice: at-time-zone conjunct + grouping timezone.
      expect(
        values.filter((value) => value === hostile).length,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  test("hostile strings stay out of the group-facts projection", () => {
    const hostile = HOSTILE_STRINGS[0];
    if (hostile === undefined) throw new Error("expected hostile string");
    const compiled = compileGroupFactsProjection(
      makeInput({
        plan: makePlan({
          source: "player_groups",
          where: {
            kind: "compare",
            op: "=",
            left: col("champion"),
            right: lit(hostile),
          },
          outputs: [
            {
              name: "kills",
              expr: {
                kind: "aggregate",
                func: "sum",
                arg: col("kills"),
                distinct: false,
              },
              displayKind: "count",
              additive: true,
              evidence: { kind: "sample" },
            },
          ],
          groupings: [{ kind: "group", size: 2, name: "group" }],
        }),
      }),
    );
    if (compiled === undefined) throw new Error("expected compiled projection");
    expect(compiled.factsSql).not.toContain("DROP TABLE");
    expect(compiled.factsSql).not.toContain(hostile);
    expect(compiled.scannedSql).not.toContain(hostile);
    expect(paramValues(compiled.factsParams)).toContain(hostile);
  });
});

// ── Seeded random plan walk with a closed-token allowlist ───────────────────

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Rnd = () => number;

function pick<T>(rnd: Rnd, items: readonly T[]): T {
  const item = items[Math.floor(rnd() * items.length)];
  if (item === undefined) {
    throw new Error("pick from empty list");
  }
  return item;
}

type ColumnPool = {
  numeric: readonly string[];
  text: readonly string[];
  dims: readonly string[];
  timeColumn: string;
  playerRef: boolean;
};

const MATCH_POOL: Omit<ColumnPool, "playerRef"> = {
  numeric: ["kills", "deaths", "assists", "gold_earned", "vision_score"],
  text: ["queue", "game_mode", "champion_name"],
  dims: [
    "player",
    "champion",
    "queue",
    "outcome",
    "patch",
    "team_position",
    "map",
  ],
  timeColumn: "game_creation_at",
};

const PREMATCH_POOL: Omit<ColumnPool, "playerRef"> = {
  numeric: ["champion_id", "map_id", "team_id"],
  text: ["queue", "game_mode"],
  dims: ["player", "champion", "queue", "map"],
  timeColumn: "observed_at",
};

function randomScalar(rnd: Rnd, pool: ColumnPool): ScoutQlScalarExpr {
  const roll = rnd();
  if (roll < 0.4) return col(pick(rnd, pool.numeric));
  if (roll < 0.6) return lit(Math.floor(rnd() * 100));
  if (roll < 0.75) {
    return {
      kind: "arithmetic",
      op: pick(rnd, ["+", "-", "*", "/"]),
      left: col(pick(rnd, pool.numeric)),
      right: lit(1 + Math.floor(rnd() * 9)),
    };
  }
  if (roll < 0.9) {
    return {
      kind: "cast",
      to: "double",
      operand: col(pick(rnd, pool.numeric)),
    };
  }
  return {
    kind: "scalar-call",
    func: pick(rnd, ["floor", "abs", "ceil"]),
    args: [col(pick(rnd, pool.numeric))],
  };
}

function randomLeaf(rnd: Rnd, pool: ColumnPool): ScoutQlPredicate {
  const roll = rnd();
  const hostile = pick(rnd, HOSTILE_STRINGS);
  if (pool.playerRef && roll < 0.12) return { kind: "player-ref", index: 0 };
  if (roll < 0.4) {
    return {
      kind: "compare",
      op: pick(rnd, ["=", "!=", "<", "<=", ">", ">=", "like", "ilike"]),
      left: col(pick(rnd, pool.text)),
      right: lit(hostile),
    };
  }
  if (roll < 0.6) {
    return {
      kind: "in",
      operand: col(pick(rnd, pool.text)),
      negated: rnd() < 0.5,
      items: [hostile, `${hostile}!`],
    };
  }
  if (roll < 0.8) {
    return {
      kind: "between",
      operand: randomScalar(rnd, pool),
      negated: rnd() < 0.5,
      low: lit(Math.floor(rnd() * 10)),
      high: lit(10 + Math.floor(rnd() * 90)),
    };
  }
  return {
    kind: "is-null",
    operand: col(pick(rnd, pool.text)),
    negated: rnd() < 0.5,
  };
}

function randomPredicate(
  rnd: Rnd,
  pool: ColumnPool,
  depth: number,
): ScoutQlPredicate {
  if (depth <= 0 || rnd() < 0.5) {
    return randomLeaf(rnd, pool);
  }
  const roll = rnd();
  const child = () => randomPredicate(rnd, pool, depth - 1);
  if (roll < 0.4) return { kind: "and", operands: [child(), child()] };
  if (roll < 0.8) return { kind: "or", operands: [child(), child()] };
  return { kind: "not", operand: child() };
}

function randomAggregate(rnd: Rnd, pool: ColumnPool): ScoutQlAggregateExpr {
  const roll = rnd();
  const filter = rnd() < 0.35 ? randomPredicate(rnd, pool, 1) : undefined;
  if (roll < 0.25) return { kind: "count-star", filter };
  if (roll < 0.4) {
    return {
      kind: "aggregate",
      func: "count",
      arg: col(pick(rnd, pool.text)),
      distinct: rnd() < 0.5,
      filter,
    };
  }
  if (roll < 0.7) {
    return {
      kind: "aggregate",
      func: pick(rnd, ["sum", "avg", "min", "max", "median", "stddev"]),
      arg: randomScalar(rnd, pool),
      distinct: false,
      filter,
    };
  }
  if (roll < 0.85) {
    return {
      kind: "quantile",
      arg: col(pick(rnd, pool.numeric)),
      q: 0.1 + Math.floor(rnd() * 8) / 10,
      filter,
    };
  }
  return {
    kind: "arithmetic",
    op: pick(rnd, ["+", "-", "*", "/"]),
    left: { kind: "count-star" },
    right: {
      kind: "aggregate",
      func: "sum",
      arg: col(pick(rnd, pool.numeric)),
      distinct: false,
    },
  };
}

function randomGrouping(
  rnd: Rnd,
  pool: ColumnPool,
  index: number,
): ScoutQlGrouping {
  const name = `g_${index.toString()}`;
  const roll = rnd();
  if (roll < 0.5) {
    return { kind: "column", column: pick(rnd, pool.dims), name };
  }
  if (roll < 0.75) {
    return {
      kind: "date-trunc",
      part: pick(rnd, ["day", "week", "month"]),
      column: pool.timeColumn,
      timezone: pick(rnd, [
        "UTC",
        "America/Los_Angeles",
        pick(rnd, HOSTILE_STRINGS),
      ]),
      name,
    };
  }
  const width = pick(rnd, [2, 5, 10]);
  return {
    kind: "expression",
    expr: {
      kind: "arithmetic",
      op: "*",
      left: {
        kind: "scalar-call",
        func: "floor",
        args: [
          {
            kind: "arithmetic",
            op: "/",
            left: col(pick(rnd, pool.numeric)),
            right: lit(width),
          },
        ],
      },
      right: lit(width),
    },
    name,
  };
}

function randomPlanInput(rnd: Rnd): PlanQueryInput {
  const prematch = rnd() < 0.3;
  const global = rnd() < 0.3;
  const usePlayerRef = rnd() < 0.4;
  const pool: ColumnPool = {
    ...(prematch ? PREMATCH_POOL : MATCH_POOL),
    playerRef: usePlayerRef,
  };

  const outputCount = 1 + Math.floor(rnd() * 3);
  const outputs: ScoutQlOutput[] = [];
  for (let index = 0; index < outputCount; index += 1) {
    outputs.push({
      name: `out_${index.toString()}`,
      expr: randomAggregate(rnd, pool),
      displayKind: "decimal",
      additive: false,
      evidence:
        rnd() < 0.3
          ? {
              kind: "ratio",
              numerator: { kind: "count-star" },
              denominator: { kind: "count-star" },
            }
          : { kind: "sample" },
    });
  }
  const groupingCount = Math.floor(rnd() * 3);
  const groupings: ScoutQlGrouping[] = [];
  for (let index = 0; index < groupingCount; index += 1) {
    groupings.push(randomGrouping(rnd, pool, index));
  }
  const orderBy: ScoutQlPlan["orderBy"] = [];
  if (rnd() < 0.6) {
    orderBy.push({
      target: { kind: "output", name: `out_0` },
      direction: rnd() < 0.5 ? "asc" : "desc",
    });
  }
  if (groupings.length > 0 && rnd() < 0.4) {
    orderBy.push({
      target: { kind: "grouping", index: 0 },
      direction: rnd() < 0.5 ? "asc" : "desc",
    });
  }
  const plan = makePlan({
    source: prematch ? "prematch_participants" : "match_participants",
    outputs,
    where: rnd() < 0.8 ? randomPredicate(rnd, pool, 2) : undefined,
    groupings,
    having:
      rnd() < 0.3
        ? {
            kind: "compare",
            op: ">=",
            left: { kind: "output-ref", name: "out_0" },
            right: { kind: "literal", value: Math.floor(rnd() * 5) },
          }
        : undefined,
    orderBy,
    playerRefs: usePlayerRef ? ["someone"] : [],
  });
  return makeInput({
    plan,
    scope: global ? GLOBAL_SCOPE : guildScope(TEST_GUILD_ID),
    playerPuuids: usePlayerRef
      ? new Map([[0, [pick(rnd, HOSTILE_STRINGS), "PUUID-ok"]]])
      : undefined,
    limit: 1 + Math.floor(rnd() * 100),
  });
}

const CLOSED_STRING_LITERALS = new Set([
  "'VARCHAR'",
  "'INTEGER'",
  "'BIGINT'",
  "'DOUBLE'",
  "'BOOLEAN'",
  "'TIMESTAMP'",
  "'newline_delimited'",
  "'UTC'",
  "'Win'",
  "'Loss'",
  "'Early surrender'",
  "'Surrender'",
  "'Played out'",
  "'unknown'",
  "'Not Arena'",
  "'All'",
  "' • '",
  "'#'",
  "'%Y-%m-%d'",
  "'%Y-%m'",
  String.raw`'^[0-9]+\.[0-9]+'`,
  "'day'",
  "'week'",
  "'month'",
]);

const IDENTIFIER_ALLOWLIST = new Set([
  // Keywords / clause words
  "WITH",
  "AS",
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "ON",
  "GROUP",
  "BY",
  "HAVING",
  "ORDER",
  "LIMIT",
  "AND",
  "OR",
  "NOT",
  "IN",
  "BETWEEN",
  "IS",
  "NULL",
  "NULLS",
  "LAST",
  "ASC",
  "DESC",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "FILTER",
  "DISTINCT",
  "UNION",
  "ALL",
  "NAME",
  "QUALIFY",
  "OVER",
  "PARTITION",
  "LIKE",
  "ILIKE",
  "CAST",
  "DATE",
  // Types
  "VARCHAR",
  "INTEGER",
  "BIGINT",
  "DOUBLE",
  "BOOLEAN",
  "TIMESTAMP",
  // Functions
  "read_parquet",
  "read_json",
  "format",
  "columns",
  "unnest",
  "row_number",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "MEDIAN",
  "STDDEV",
  "QUANTILE_CONT",
  "coalesce",
  "nullif",
  "greatest",
  "least",
  "round",
  "floor",
  "ceil",
  "abs",
  "date_trunc",
  "timezone",
  "strftime",
  "epoch_ms",
  "concat_ws",
  "any_value",
  "arg_max",
  "regexp_extract",
  "now",
  "lower",
  "src",
  "to_seconds",
  "to_minutes",
  "to_hours",
  "to_days",
  "to_weeks",
  "to_months",
  "to_years",
  // Relation aliases / fixed hidden columns / accounts-dimension columns
  "m",
  "a",
  "facts",
  "filtered",
  "accounts",
  "deduped",
  "label",
  "scanned",
  "server_id",
  "player_id",
  "player_alias",
  "discord_id",
  ...Object.keys(MATCH_LAKE_COLUMNS),
  ...Object.keys(PREMATCH_LAKE_COLUMNS),
]);

const ALIAS_PATTERN = /^(?:expr|__key|__succ|__n|__num|__den)_\d+$/u;

function assertClosedVocabulary(sql: string): void {
  expect(sql).not.toContain(";");
  expect(sql).not.toContain("--");
  const literalPattern = /'(?:[^']|'')*'/gu;
  for (const literal of sql.match(literalPattern) ?? []) {
    expect(CLOSED_STRING_LITERALS).toContain(literal);
  }
  const stripped = sql.replaceAll(literalPattern, " ");
  for (const token of stripped.match(/[A-Za-z_]\w*/gu) ?? []) {
    if (ALIAS_PATTERN.test(token)) continue;
    if (!IDENTIFIER_ALLOWLIST.has(token)) {
      throw new Error(`SQL token outside the closed vocabulary: "${token}"`);
    }
  }
}

describe("seeded random plan walk", () => {
  test("200 random plans emit only closed-vocabulary SQL with balanced params", () => {
    const rnd = mulberry32(0xc0_ff_ee);
    for (let index = 0; index < 200; index += 1) {
      const input = randomPlanInput(rnd);
      const compiled = mustCompile(input);
      for (const [sql, params] of [
        [compiled.aggregateSql, compiled.aggregateParams],
        [compiled.scannedSql, compiled.scannedParams],
      ] as const) {
        assertClosedVocabulary(sql);
        // Structural desync check: one `?` per bound parameter, in order.
        const placeholders =
          sql.replaceAll(/'(?:[^']|'')*'/gu, " ").split("?").length - 1;
        expect(placeholders).toBe(params.length);
      }
    }
  });
});
