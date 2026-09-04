import { describe, expect, test } from "vitest";
import { DEFAULT_RENDER_SPEC } from "@scout-for-lol/data/model/report.ts";
import type {
  ScoutQlOutput,
  ScoutQlPlan,
} from "@scout-for-lol/data/model/scoutql/plan.ts";
import type {
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/expression.ts";
import {
  compileGroupFactsProjection,
  compileScoutQlPlanQuery,
  type PlanQueryInput,
} from "#src/reports/duckdb/compile-plan.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";
import { GLOBAL_SCOPE, guildScope } from "#src/reports/duckdb/scope.ts";
import {
  TEST_GUILD_ID,
  TEST_LAKE_FILES,
  paramValues,
} from "#src/testing/test-lake-files.ts";

function countOutput(name: string): ScoutQlOutput {
  return {
    name,
    expr: { kind: "count-star" },
    displayKind: "count",
    additive: true,
    evidence: { kind: "sample" },
  };
}

function makePlan(overrides: Partial<ScoutQlPlan> = {}): ScoutQlPlan {
  return {
    source: "match_participants",
    outputs: [countOutput("games")],
    timeWindow: { kind: "unbounded" },
    groupings: [],
    orderBy: [],
    limit: 25,
    playerRefs: [],
    render: DEFAULT_RENDER_SPEC,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PlanQueryInput> = {}): PlanQueryInput {
  return {
    plan: makePlan(),
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

function col(column: string): ScoutQlScalarExpr {
  return { kind: "column", column };
}

function eq(
  column: string,
  value: number | string | boolean,
): ScoutQlPredicate {
  return {
    kind: "compare",
    op: "=",
    left: col(column),
    right: { kind: "literal", value },
  };
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function mustCompile(input: PlanQueryInput) {
  const compiled = compileScoutQlPlanQuery(input);
  if (compiled === undefined) {
    throw new Error("expected compiled query");
  }
  return compiled;
}

const EMPTY_LAKE: LakeFiles = {
  matchesParquet: [],
  matchesStaging: [],
  matchTeamsParquet: [],
  matchTeamsStaging: [],
  matchTeamBansParquet: [],
  matchTeamBansStaging: [],
  prematchParquet: [],
  prematchStaging: [],
  accountsParquet: undefined,
  competitionRankHistoryParquet: [],
  competitionRankHistoryStaging: [],
  timelineEventsParquet: [],
  timelineEventsStaging: [],
  timelineEventParticipantsParquet: [],
  timelineEventParticipantsStaging: [],
  timelineParticipantFramesParquet: [],
  timelineParticipantFramesStaging: [],
  timelineCoverageParquet: [],
  timelineCoverageStaging: [],
};

describe("pushdown", () => {
  test("identity-free conjuncts and the range push into both union branches", () => {
    const compiled = mustCompile(
      makeInput({ plan: makePlan({ where: eq("queue", "solo") }) }),
    );
    expect(occurrences(compiled.aggregateSql, "((queue) = (?))")).toBe(2);
    expect(
      occurrences(
        compiled.aggregateSql,
        "epoch_ms(game_creation_at) BETWEEN ? AND ?",
      ),
    ).toBe(2);
    expect(compiled.aggregateSql).toContain("UNION ALL BY NAME");
    expect(compiled.aggregateSql).toContain(
      "PARTITION BY match_id, puuid ORDER BY src",
    );
    // The dedupe must wrap a subquery that already contains the WHERE.
    expect(compiled.aggregateSql.indexOf("((queue) = (?))")).toBeLessThan(
      compiled.aggregateSql.indexOf("QUALIFY"),
    );
    expect(paramValues(compiled.aggregateParams)).toEqual(
      expect.arrayContaining(["solo", 1_700_000_000_000, 1_700_600_000_000]),
    );
  });

  test("player-ref conjuncts push to the source branches as puuid IN", () => {
    const compiled = mustCompile(
      makeInput({
        plan: makePlan({
          playerRefs: ["someone"],
          where: { kind: "player-ref", index: 0 },
        }),
        playerPuuids: new Map([[0, ["PUUID-A"]]]),
      }),
    );
    expect(
      occurrences(compiled.aggregateSql, "(puuid IN (SELECT unnest(?)))"),
    ).toBe(2);
    expect(compiled.aggregateSql).not.toContain("filtered");
  });

  test("identity-touching conjuncts stay behind the facts CTE", () => {
    const compiled = mustCompile(
      makeInput({
        plan: makePlan({
          where: {
            kind: "and",
            operands: [eq("queue", "solo"), eq("player", "alice")],
          },
        }),
      }),
    );
    // queue pushes into both branches; player compiles once, against facts.
    expect(occurrences(compiled.aggregateSql, "((queue) = (?))")).toBe(2);
    expect(occurrences(compiled.aggregateSql, "((player_alias) = (?))")).toBe(
      1,
    );
    expect(compiled.aggregateSql).toContain(
      "filtered AS (SELECT * FROM facts WHERE",
    );
    expect(compiled.aggregateSql).toContain("FROM filtered");
    expect(compiled.scannedSql).toContain(
      "SELECT (COUNT(*))::BIGINT AS scanned FROM filtered",
    );
  });

  test("an OR-tree containing identity is not pushed; a source-only OR-tree is", () => {
    const identityOr: ScoutQlPredicate = {
      kind: "or",
      operands: [eq("queue", "solo"), eq("player", "alice")],
    };
    const withIdentity = mustCompile(
      makeInput({ plan: makePlan({ where: identityOr }) }),
    );
    expect(occurrences(withIdentity.aggregateSql, "((queue) = (?))")).toBe(1);
    const sourceOr: ScoutQlPredicate = {
      kind: "or",
      operands: [eq("queue", "solo"), eq("win", true)],
    };
    const withoutIdentity = mustCompile(
      makeInput({ plan: makePlan({ where: sourceOr }) }),
    );
    expect(occurrences(withoutIdentity.aggregateSql, "((queue) = (?))")).toBe(
      2,
    );
    expect(withoutIdentity.aggregateSql).not.toContain("filtered");
  });

  test("prematch pushes every conjunct and scans symmetrically (legacy asymmetry dropped)", () => {
    // TEST_LAKE_FILES has no prematch staging file, so the union collapses to
    // its parquet branch — one occurrence per statement, in BOTH statements.
    const compiled = mustCompile(
      makeInput({
        plan: makePlan({
          source: "prematch_participants",
          where: eq("champion_id", 22),
        }),
      }),
    );
    expect(
      occurrences(
        compiled.aggregateSql,
        "epoch_ms(observed_at) BETWEEN ? AND ?",
      ),
    ).toBe(1);
    expect(occurrences(compiled.aggregateSql, "((champion_id) = (?))")).toBe(1);
    expect(occurrences(compiled.scannedSql, "((champion_id) = (?))")).toBe(1);
    expect(compiled.scannedSql).toContain(
      "SELECT (COUNT(*))::BIGINT AS scanned FROM facts",
    );
  });
});

describe("guards and short-circuits", () => {
  test("empty lake compiles to undefined", () => {
    expect(compileScoutQlPlanQuery(makeInput({ files: EMPTY_LAKE }))).toBe(
      undefined,
    );
  });

  test("guild scope without accounts.parquet short-circuits; global does not", () => {
    const noAccounts = { ...TEST_LAKE_FILES, accountsParquet: undefined };
    expect(compileScoutQlPlanQuery(makeInput({ files: noAccounts }))).toBe(
      undefined,
    );
    const global = mustCompile(
      makeInput({ files: noAccounts, scope: GLOBAL_SCOPE }),
    );
    expect(global.aggregateSql).not.toContain("JOIN accounts");
    expect(global.aggregateSql).toContain(
      "concat_ws('#', m.riot_id_game_name, m.riot_id_tagline) AS player_alias",
    );
  });

  test("global scope with playerIds throws", () => {
    expect(() =>
      compileScoutQlPlanQuery(
        makeInput({ scope: GLOBAL_SCOPE, playerIds: [1] }),
      ),
    ).toThrow(/playerIds scoping requires a guild scope/);
  });

  test("competition source guards", () => {
    const competition = makePlan({
      source: "competition_match_participants",
      competitionId: 7,
    });
    expect(() =>
      compileScoutQlPlanQuery(
        makeInput({ plan: competition, scope: GLOBAL_SCOPE }),
      ),
    ).toThrow(/not available in global scope/);
    expect(() =>
      compileScoutQlPlanQuery(
        makeInput({
          plan: makePlan({ source: "competition_match_participants" }),
        }),
      ),
    ).toThrow(/requires a competition_id/);
    const compiled = mustCompile(
      makeInput({ plan: competition, playerIds: [7, 8, 9] }),
    );
    expect(compiled.aggregateSql).toContain("player_id IN (SELECT unnest(?))");
    expect(paramValues(compiled.aggregateParams)).toEqual(
      expect.arrayContaining([7, 8, 9]),
    );
    expect(
      compileScoutQlPlanQuery(makeInput({ plan: competition, playerIds: [] })),
    ).toBe(undefined);
  });

  test("rank and group sources refuse this entry point", () => {
    expect(() =>
      compileScoutQlPlanQuery(
        makeInput({ plan: makePlan({ source: "rank_current" }) }),
      ),
    ).toThrow(/rank sources are not lake-backed/);
    expect(() =>
      compileScoutQlPlanQuery(
        makeInput({ plan: makePlan({ source: "player_groups" }) }),
      ),
    ).toThrow(/compileGroupFactsProjection/);
  });

  test("unknown columns throw", () => {
    expect(() =>
      compileScoutQlPlanQuery(
        makeInput({ plan: makePlan({ where: eq("evil_column", 1) }) }),
      ),
    ).toThrow(/Unknown column "evil_column"/);
  });

  test("node caps: per-expression and whole-plan budgets", () => {
    let wide: ScoutQlScalarExpr = col("kills");
    for (let index = 0; index < 40; index += 1) {
      wide = {
        kind: "arithmetic",
        op: "+",
        left: wide,
        right: { kind: "literal", value: 1 },
      };
    }
    expect(() =>
      compileScoutQlPlanQuery(
        makeInput({
          plan: makePlan({
            outputs: [
              {
                name: "big",
                expr: {
                  kind: "aggregate",
                  func: "sum",
                  arg: wide,
                  distinct: false,
                },
                displayKind: "decimal",
                additive: true,
                evidence: { kind: "sample" },
              },
            ],
          }),
        }),
      ),
    ).toThrow(/64-node expression cap/);

    let medium: ScoutQlScalarExpr = col("kills");
    for (let index = 0; index < 25; index += 1) {
      medium = {
        kind: "arithmetic",
        op: "+",
        left: medium,
        right: { kind: "literal", value: 1 },
      };
    }
    const mediumOutput = (name: string): ScoutQlOutput => ({
      name,
      expr: { kind: "aggregate", func: "sum", arg: medium, distinct: false },
      displayKind: "decimal",
      additive: true,
      evidence: { kind: "sample" },
    });
    expect(() =>
      compileScoutQlPlanQuery(
        makeInput({
          plan: makePlan({
            outputs: ["a", "b", "c", "d", "e"].map((name) =>
              mediumOutput(name),
            ),
          }),
        }),
      ),
    ).toThrow(/256-node budget/);
  });
});

describe("select shape", () => {
  test("positional aliases only — user names never reach SQL", () => {
    const compiled = mustCompile(
      makeInput({
        plan: makePlan({
          outputs: [countOutput("my_very_own_output_name")],
          orderBy: [
            {
              target: { kind: "output", name: "my_very_own_output_name" },
              direction: "desc",
            },
          ],
        }),
      }),
    );
    expect(compiled.aggregateSql).not.toContain("my_very_own_output_name");
    expect(compiled.aggregateSql).toContain("AS expr_0");
    expect(compiled.aggregateSql).toContain(
      "ORDER BY expr_0 DESC NULLS LAST, label ASC NULLS LAST LIMIT ?",
    );
    const lastParam = compiled.aggregateParams.at(-1);
    expect(lastParam).toEqual({ kind: "scalar", value: 25 });
    // The sample companion's SQL is identical to the output itself, so the
    // dedupe pool maps it back onto expr_0 instead of emitting __n_0.
    expect(compiled.columns.outputs).toEqual([
      {
        name: "my_very_own_output_name",
        alias: "expr_0",
        evidence: { kind: "sample", sampleCount: "expr_0" },
      },
    ]);
    expect(compiled.aggregateSql).not.toContain("__n_0");
  });

  test("grouping echo outputs read from the grouping key", () => {
    const compiled = mustCompile(
      makeInput({
        plan: makePlan({
          outputs: [
            {
              name: "queue",
              expr: { kind: "grouping-ref", index: 0 },
              displayKind: "text",
              additive: false,
              evidence: { kind: "sample" },
            },
            countOutput("games"),
          ],
          groupings: [{ kind: "column", column: "queue", name: "queue" }],
          orderBy: [
            { target: { kind: "grouping", index: 0 }, direction: "asc" },
          ],
        }),
      }),
    );
    expect(compiled.columns.outputs[0]?.alias).toBe("__key_0");
    expect(compiled.columns.groupingKeys).toEqual(["__key_0"]);
    expect(compiled.aggregateSql).toContain("GROUP BY __key_0");
    // Ordered by the plan's single grouping: label append is skipped.
    expect(compiled.aggregateSql).toContain(
      "ORDER BY __key_0 ASC NULLS LAST LIMIT ?",
    );
  });

  test("guild player grouping carries identity; other groupings NULL it", () => {
    const byPlayer = mustCompile(
      makeInput({
        plan: makePlan({
          groupings: [{ kind: "column", column: "player", name: "player" }],
        }),
      }),
    );
    expect(byPlayer.aggregateSql).toContain(
      "any_value(player_id) AS player_id",
    );
    expect(byPlayer.aggregateSql).toContain(
      "any_value(discord_id) AS discord_id",
    );
    expect(byPlayer.aggregateSql).toContain("any_value(player_alias) AS label");
    const byQueue = mustCompile(
      makeInput({
        plan: makePlan({
          groupings: [{ kind: "column", column: "queue", name: "queue" }],
        }),
      }),
    );
    expect(byQueue.aggregateSql).toContain("NULL::BIGINT AS player_id");
    expect(byQueue.aggregateSql).toContain("NULL::VARCHAR AS discord_id");
  });

  test("global player grouping keys puuid and labels the most recent Riot ID", () => {
    const compiled = mustCompile(
      makeInput({
        scope: GLOBAL_SCOPE,
        plan: makePlan({
          groupings: [{ kind: "column", column: "player", name: "player" }],
        }),
      }),
    );
    expect(compiled.aggregateSql).toContain(
      "arg_max(player_alias, game_creation_at) AS label",
    );
    expect(compiled.aggregateSql).toContain("(puuid) AS __key_0");
    expect(compiled.aggregateSql).toContain("NULL::BIGINT AS player_id");
  });
});

describe("evidence, having, and grouping arms", () => {
  test("rate evidence emits deduplicated companions", () => {
    const winRate: ScoutQlOutput = {
      name: "win_rate",
      expr: {
        kind: "aggregate",
        func: "avg",
        arg: { kind: "cast", to: "int", operand: col("win") },
        distinct: false,
      },
      displayKind: "percent",
      additive: false,
      evidence: {
        kind: "rate",
        successes: { kind: "count-star", filter: eq("win", true) },
        trials: { kind: "count-star" },
      },
    };
    const compiled = mustCompile(
      makeInput({
        plan: makePlan({ outputs: [winRate, countOutput("games")] }),
      }),
    );
    expect(compiled.aggregateSql).toContain("AS __succ_0");
    // The rate's trials expression is COUNT(*) — identical to the games
    // output — so it dedupes onto expr_1 and no __n_ column is emitted.
    expect(compiled.aggregateSql).not.toContain("AS __n_");
    expect(compiled.columns.outputs[0]?.evidence).toEqual({
      kind: "rate",
      successes: "__succ_0",
      trials: "expr_1",
    });
    expect(compiled.columns.outputs[1]?.evidence).toEqual({
      kind: "sample",
      sampleCount: "expr_1",
    });
  });

  test("HAVING resolves output-refs to positional aliases; ungrouped guard applies", () => {
    const compiled = mustCompile(
      makeInput({
        plan: makePlan({
          having: {
            kind: "compare",
            op: ">=",
            left: { kind: "output-ref", name: "games" },
            right: { kind: "literal", value: 5 },
          },
        }),
      }),
    );
    expect(compiled.aggregateSql).toContain(
      "HAVING (((expr_0) >= ((?::DOUBLE)))) AND (COUNT(*) > 0)",
    );
  });

  test("bucket expression grouping binds the width and validates the shape", () => {
    const bucket: ScoutQlScalarExpr = {
      kind: "arithmetic",
      op: "*",
      left: {
        kind: "scalar-call",
        func: "floor",
        args: [
          {
            kind: "arithmetic",
            op: "/",
            left: col("kills"),
            right: { kind: "literal", value: 5 },
          },
        ],
      },
      right: { kind: "literal", value: 5 },
    };
    const compiled = mustCompile(
      makeInput({
        plan: makePlan({
          groupings: [{ kind: "expression", expr: bucket, name: "bucket" }],
        }),
      }),
    );
    expect(compiled.aggregateSql).toContain(
      "(((floor((((kills) / nullif((?), 0))))) * (?))) AS __key_0",
    );
    expect(compiled.aggregateSql).toContain("GROUP BY __key_0");
    expect(() =>
      compileScoutQlPlanQuery(
        makeInput({
          plan: makePlan({
            groupings: [
              { kind: "expression", expr: col("kills"), name: "bucket" },
            ],
          }),
        }),
      ),
    ).toThrow(/FLOOR-based numeric buckets/);
    expect(() =>
      compileScoutQlPlanQuery(
        makeInput({
          plan: makePlan({
            groupings: [
              {
                kind: "expression",
                expr: {
                  kind: "scalar-call",
                  func: "floor",
                  args: [{ kind: "now", which: "timestamp" }],
                },
                name: "bucket",
              },
            ],
          }),
        }),
      ),
    ).toThrow(/must not reference the current time/);
  });

  test("date-trunc grouping binds the timezone and formats the label", () => {
    const compiled = mustCompile(
      makeInput({
        plan: makePlan({
          groupings: [
            {
              kind: "date-trunc",
              part: "week",
              column: "game_creation_at",
              timezone: "America/Los_Angeles",
              name: "week",
            },
          ],
        }),
      }),
    );
    expect(compiled.aggregateSql).toContain(
      "date_trunc('week', timezone(?, timezone('UTC', (game_creation_at))))",
    );
    expect(compiled.aggregateSql).toContain("strftime(");
    expect(compiled.aggregateSql).toContain("'%Y-%m-%d'");
    expect(paramValues(compiled.aggregateParams)).toEqual(
      expect.arrayContaining(["America/Los_Angeles"]),
    );
    expect(compiled.aggregateSql).not.toContain("America/Los_Angeles");
  });

  test("dimension groupings replicate the legacy labeling arms", () => {
    const compiled = mustCompile(
      makeInput({
        plan: makePlan({
          groupings: [
            { kind: "column", column: "outcome", name: "outcome" },
            { kind: "column", column: "surrender_state", name: "surrender" },
          ],
        }),
      }),
    );
    expect(compiled.aggregateSql).toContain("(win) AS __key_0");
    // The label references the key laterally, so its params bind only once.
    expect(compiled.aggregateSql).toContain(
      "CASE WHEN __key_0 THEN 'Win' ELSE 'Loss' END",
    );
    expect(compiled.aggregateSql).toContain(
      "CASE WHEN early_surrendered THEN 'Early surrender' WHEN surrendered THEN 'Surrender' ELSE 'Played out' END",
    );
    expect(compiled.aggregateSql).toContain("concat_ws(' • ', ");
  });
});

function groupPlan(overrides: Partial<ScoutQlPlan> = {}): ScoutQlPlan {
  return makePlan({
    source: "player_groups",
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
    ...overrides,
  });
}

describe("group facts projection", () => {
  test("projects unit/identity columns plus only referenced value columns", () => {
    const compiled = compileGroupFactsProjection(
      makeInput({ plan: groupPlan() }),
    );
    if (compiled === undefined) throw new Error("expected compiled projection");
    expect(compiled.factsSql).toContain(
      "QUALIFY row_number() OVER (PARTITION BY match_id, team_id, player_subteam_id, player_id ORDER BY puuid) = 1",
    );
    expect(compiled.factsSql).toContain(
      "QUALIFY count(*) OVER (PARTITION BY match_id, team_id, player_subteam_id) >= 2",
    );
    expect(compiled.columns.raw).toEqual(["kills"]);
    expect(compiled.factsSql).toContain("m.kills AS kills");
    expect(compiled.factsSql).not.toContain("m.deaths");
    expect(compiled.scannedSql).toContain(
      "SELECT (COUNT(*))::BIGINT AS scanned FROM facts",
    );
  });

  test("virtual columns project under their own names with deps available", () => {
    const compiled = compileGroupFactsProjection(
      makeInput({
        plan: groupPlan({
          where: {
            kind: "or",
            operands: [eq("champion", "Ashe"), eq("player", "alice")],
          },
        }),
      }),
    );
    if (compiled === undefined) throw new Error("expected compiled projection");
    expect(compiled.factsSql).toContain("(champion_name) AS champion");
    expect(compiled.factsSql).toContain("m.champion_name AS champion_name");
    expect(compiled.columns.raw).toEqual(["champion", "kills"]);
  });

  test("global scope and wrong sources refuse the projection", () => {
    expect(() =>
      compileGroupFactsProjection(
        makeInput({ plan: groupPlan(), scope: GLOBAL_SCOPE }),
      ),
    ).toThrow(/not available in global scope/);
    expect(() =>
      compileGroupFactsProjection(makeInput({ plan: makePlan() })),
    ).toThrow(/does not use the group-facts projection/);
    expect(() =>
      compileGroupFactsProjection(
        makeInput({ plan: groupPlan({ groupings: [] }) }),
      ),
    ).toThrow(/requires exactly GROUP BY group/);
  });
});
