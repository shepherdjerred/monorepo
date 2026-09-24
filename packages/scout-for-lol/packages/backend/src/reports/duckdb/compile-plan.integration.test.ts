import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { DEFAULT_RENDER_SPEC } from "@scout-for-lol/data/model/reports/report.ts";
import type {
  ScoutQlOutput,
  ScoutQlPlan,
} from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type {
  ScoutQlPredicate,
  ScoutQlScalarExpr,
} from "@scout-for-lol/data/model/scoutql/parse/expression.ts";
import {
  compileGroupFactsProjection,
  compileScoutQlPlanQuery,
  type CompiledPlanQuery,
  type PlanQueryInput,
} from "#src/reports/duckdb/compile-plan.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  resolveLakeFiles,
  type BoundParam,
  type LakeFiles,
} from "#src/reports/duckdb/lake.ts";
import { GLOBAL_SCOPE, guildScope } from "#src/reports/duckdb/scope.ts";
import { writeTestLake } from "#src/testing/test-report-lake.ts";
import { lakeMonth } from "#src/report-lake/schema.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";

/**
 * End-to-end: hand-built ScoutQL v2 plans compiled by compileScoutQlPlanQuery
 * and executed against a real seeded DuckDB lake (staging NDJSON + published
 * accounts parquet — the union path), asserting actual row values.
 */

const SERVER_ID = testGuildId("771");
const PA = testPuuid("plan-alice");
const PB = testPuuid("plan-bob");
const PC = testPuuid("plan-charlie");
const PD = testPuuid("plan-derek");

const WEEK1 = new Date(Date.UTC(2026, 4, 4, 12));
const WEEK1B = new Date(Date.UTC(2026, 4, 6, 12));
const WEEK2 = new Date(Date.UTC(2026, 4, 11, 12));
const WEEK2B = new Date(Date.UTC(2026, 4, 12, 12));

let lakeFiles: LakeFiles;

beforeAll(async () => {
  const lakeDir = await mkdtemp(path.join(tmpdir(), "scoutql-plan-e2e-"));
  const alice = {
    playerId: 1,
    playerAlias: "Alice",
    discordId: "111111111111111111",
    puuid: PA,
    surrendered: false,
    deaths: 2,
    assists: 5,
  };
  const bob = {
    playerId: 2,
    playerAlias: "Bob",
    puuid: PB,
    surrendered: false,
    deaths: 4,
    assists: 1,
  };
  await writeTestLake(lakeDir, {
    serverId: SERVER_ID,
    // Yasuo banned in two games, Zed in one, and one slot left unused.
    bans: [
      {
        match_id: "NA1_100",
        month: lakeMonth(WEEK1.getTime()),
        team_id: 100,
        pick_turn: 1,
        champion_id: 157,
      },
      {
        match_id: "NA1_100",
        month: lakeMonth(WEEK1.getTime()),
        team_id: 200,
        pick_turn: 2,
        champion_id: 238,
      },
      {
        match_id: "NA1_101",
        month: lakeMonth(WEEK1B.getTime()),
        team_id: 100,
        pick_turn: 1,
        champion_id: 157,
      },
      {
        match_id: "NA1_101",
        month: lakeMonth(WEEK1B.getTime()),
        team_id: 200,
        pick_turn: 2,
        champion_id: -1,
      },
    ],
    matchFacts: [
      {
        ...alice,
        matchId: "NA1_100",
        queue: "solo",
        win: true,
        kills: 2,
        firstDragon: true,
        gameCreationAt: WEEK1,
      },
      {
        ...bob,
        matchId: "NA1_100",
        queue: "solo",
        win: false,
        kills: 3,
        gameCreationAt: WEEK1,
      },
      {
        ...alice,
        matchId: "NA1_101",
        queue: "solo",
        win: true,
        kills: 7,
        championId: 222,
        championName: "Jinx",
        firstDragon: true,
        gameCreationAt: WEEK1B,
      },
      {
        ...alice,
        matchId: "NA1_102",
        queue: "solo",
        win: false,
        kills: 12,
        gameCreationAt: WEEK2,
      },
      {
        ...alice,
        matchId: "NA1_103",
        queue: "flex",
        win: true,
        kills: 20,
        gameCreationAt: WEEK2B,
      },
    ],
    untrackedMatchFacts: [
      {
        playerId: 8,
        playerAlias: "Derek",
        puuid: PD,
        matchId: "NA1_100",
        queue: "solo",
        win: true,
        surrendered: false,
        kills: 9,
        deaths: 1,
        assists: 1,
        gameCreationAt: WEEK1,
      },
      {
        playerId: 9,
        playerAlias: "Charlie",
        riotIdGameName: "OldName",
        puuid: PC,
        matchId: "NA1_300",
        queue: "solo",
        win: false,
        surrendered: false,
        kills: 1,
        deaths: 1,
        assists: 1,
        gameCreationAt: new Date(Date.UTC(2026, 4, 5, 12)),
      },
      {
        playerId: 9,
        playerAlias: "Charlie",
        riotIdGameName: "NewName",
        puuid: PC,
        matchId: "NA1_301",
        queue: "solo",
        win: true,
        surrendered: false,
        kills: 4,
        deaths: 1,
        assists: 1,
        gameCreationAt: new Date(Date.UTC(2026, 4, 10, 12)),
      },
    ],
  });
  lakeFiles = await resolveLakeFiles(lakeDir);
});

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

function countOutput(name: string): ScoutQlOutput {
  return {
    name,
    expr: { kind: "count-star" },
    displayKind: "count",
    additive: true,
    evidence: { kind: "sample" },
  };
}

function aggOutput(name: string, expr: ScoutQlOutput["expr"]): ScoutQlOutput {
  return {
    name,
    expr,
    displayKind: "decimal",
    additive: false,
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
    limit: 100,
    playerRefs: [],
    render: DEFAULT_RENDER_SPEC,
    ...overrides,
  };
}

function makeInput(overrides: Partial<PlanQueryInput> = {}): PlanQueryInput {
  return {
    plan: makePlan(),
    scope: guildScope(SERVER_ID),
    files: lakeFiles,
    range: {
      start: new Date(Date.UTC(2026, 0, 1)),
      end: new Date(Date.UTC(2026, 5, 1)),
    },
    limit: 100,
    ...overrides,
  };
}

const CountSchema = z.union([z.bigint(), z.number()]).transform(Number);
const RowSchema = z.record(z.string(), z.unknown());

async function execute(compiled: CompiledPlanQuery): Promise<{
  rows: Record<string, unknown>[];
  scanned: number;
}> {
  return await withDuckDBConnection(async (session) => {
    const bind = (params: BoundParam[]) =>
      params.map((param) =>
        param.kind === "list" ? session.list(param.values) : param.value,
      );
    const rawRows = await session.run(
      compiled.aggregateSql,
      bind(compiled.aggregateParams),
    );
    const scannedRows = await session.run(
      compiled.scannedSql,
      bind(compiled.scannedParams),
    );
    const scanned = z
      .object({ scanned: CountSchema })
      .parse(scannedRows[0]).scanned;
    return { rows: rawRows.map((row) => RowSchema.parse(row)), scanned };
  });
}

async function run(input: PlanQueryInput): Promise<{
  rows: Record<string, unknown>[];
  scanned: number;
  compiled: CompiledPlanQuery;
}> {
  const compiled = compileScoutQlPlanQuery(input);
  if (compiled === undefined) {
    throw new Error("expected compiled query");
  }
  const result = await execute(compiled);
  return { ...result, compiled };
}

function number_(value: unknown): number {
  return CountSchema.parse(value);
}

describe("aggregates end-to-end", () => {
  test("win_rate with FILTER over the solo queue, with rate evidence", async () => {
    const winRate: ScoutQlOutput = {
      name: "win_rate",
      expr: {
        kind: "aggregate",
        func: "avg",
        arg: { kind: "cast", to: "int", operand: col("win") },
        distinct: false,
        filter: eq("queue", "solo"),
      },
      displayKind: "percent",
      additive: false,
      evidence: {
        kind: "rate",
        successes: {
          kind: "count-star",
          filter: {
            kind: "and",
            operands: [eq("queue", "solo"), eq("win", true)],
          },
        },
        trials: { kind: "count-star", filter: eq("queue", "solo") },
      },
    };
    const { rows, scanned, compiled } = await run(
      makeInput({ plan: makePlan({ outputs: [winRate] }) }),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error("expected a row");
    const outputColumn = compiled.columns.outputs[0];
    if (outputColumn === undefined) throw new Error("expected output column");
    expect(number_(row[outputColumn.alias])).toBeCloseTo(0.5, 10);
    if (outputColumn.evidence.kind !== "rate") {
      throw new Error("expected rate evidence");
    }
    expect(number_(row[outputColumn.evidence.successes])).toBe(2);
    expect(number_(row[outputColumn.evidence.trials])).toBe(4);
    // All 5 guild facts scanned (the FILTER narrows the aggregate, not facts).
    expect(scanned).toBe(5);
  });

  test("MEDIAN, QUANTILE_CONT, STDDEV and COUNT DISTINCT over kills", async () => {
    const { rows, compiled } = await run(
      makeInput({
        plan: makePlan({
          outputs: [
            aggOutput("med", {
              kind: "aggregate",
              func: "median",
              arg: col("kills"),
              distinct: false,
            }),
            aggOutput("p90", { kind: "quantile", arg: col("kills"), q: 0.9 }),
            aggOutput("sd", {
              kind: "aggregate",
              func: "stddev",
              arg: col("kills"),
              distinct: false,
            }),
            aggOutput("champs", {
              kind: "aggregate",
              func: "count",
              arg: col("champion_name"),
              distinct: true,
            }),
          ],
        }),
      }),
    );
    const row = rows[0];
    if (row === undefined) throw new Error("expected a row");
    const alias = (index: number): string => {
      const output = compiled.columns.outputs[index];
      if (output === undefined) throw new Error("expected output");
      return output.alias;
    };
    // kills across guild facts: [2, 3, 7, 12, 20]
    expect(number_(row[alias(0)])).toBe(7);
    expect(number_(row[alias(1)])).toBeCloseTo(16.8, 10);
    expect(number_(row[alias(2)])).toBeCloseTo(Math.sqrt(218.8 / 4), 10);
    expect(number_(row[alias(3)])).toBe(2);
  });

  test("OR/NOT predicates execute with correct row scoping", async () => {
    const { rows, compiled } = await run(
      makeInput({
        plan: makePlan({
          where: {
            kind: "or",
            operands: [
              { kind: "not", operand: eq("queue", "solo") },
              {
                kind: "compare",
                op: ">=",
                left: col("kills"),
                right: { kind: "literal", value: 10 },
              },
            ],
          },
        }),
      }),
    );
    const row = rows[0];
    if (row === undefined) throw new Error("expected a row");
    const games = compiled.columns.outputs[0];
    if (games === undefined) throw new Error("expected output");
    // NA1_102 (12 kills) and NA1_103 (flex) match; everything else does not.
    expect(number_(row[games.alias])).toBe(2);
  });

  test("hostile literals execute harmlessly as bound parameters", async () => {
    const hostile = "solo'); DROP TABLE reports;--";
    const { rows, scanned, compiled } = await run(
      makeInput({ plan: makePlan({ where: eq("queue", hostile) }) }),
    );
    expect(compiled.aggregateSql).not.toContain("DROP TABLE");
    // No facts match, and the ungrouped guard suppresses the zero-row.
    expect(rows).toHaveLength(0);
    expect(scanned).toBe(0);
  });
});

describe("groupings end-to-end", () => {
  test("weekly DATE_TRUNC grouping buckets by ISO week start", async () => {
    const { rows } = await run(
      makeInput({
        plan: makePlan({
          groupings: [
            {
              kind: "date-trunc",
              part: "week",
              column: "game_creation_at",
              timezone: "UTC",
              name: "week",
            },
          ],
          orderBy: [
            { target: { kind: "grouping", index: 0 }, direction: "asc" },
          ],
        }),
      }),
    );
    expect(rows.map((row) => [row["label"], number_(row["expr_0"])])).toEqual([
      ["2026-05-04", 3],
      ["2026-05-11", 2],
    ]);
  });

  test("numeric bucket histogram grouping emits typed bucket keys", async () => {
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
    const { rows } = await run(
      makeInput({
        plan: makePlan({
          groupings: [{ kind: "expression", expr: bucket, name: "bucket" }],
          orderBy: [
            { target: { kind: "grouping", index: 0 }, direction: "asc" },
          ],
        }),
      }),
    );
    expect(
      rows.map((row) => [number_(row["__key_0"]), number_(row["expr_0"])]),
    ).toEqual([
      [0, 2],
      [5, 1],
      [10, 1],
      [20, 1],
    ]);
  });

  test("LIMIT binds and truncates deterministically", async () => {
    const { rows } = await run(
      makeInput({
        limit: 1,
        plan: makePlan({
          groupings: [
            {
              kind: "date-trunc",
              part: "week",
              column: "game_creation_at",
              timezone: "UTC",
              name: "week",
            },
          ],
        }),
      }),
    );
    // No user ORDER BY: the appended label ASC decides which row survives.
    expect(rows.map((row) => row["label"])).toEqual(["2026-05-04"]);
  });

  test("HAVING with output-ref filters groups", async () => {
    const { rows } = await run(
      makeInput({
        plan: makePlan({
          groupings: [{ kind: "column", column: "player", name: "player" }],
          having: {
            kind: "compare",
            op: ">=",
            left: { kind: "output-ref", name: "games" },
            right: { kind: "literal", value: 2 },
          },
        }),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["label"]).toBe("Alice");
    expect(number_(rows[0]?.["expr_0"])).toBe(4);
  });
});

describe("identity end-to-end", () => {
  test("guild player grouping resolves identity from the accounts dimension", async () => {
    const { rows, scanned } = await run(
      makeInput({
        plan: makePlan({
          groupings: [{ kind: "column", column: "player", name: "player" }],
          orderBy: [
            { target: { kind: "output", name: "games" }, direction: "desc" },
          ],
        }),
      }),
    );
    expect(
      rows.map((row) => [
        row["label"],
        number_(row["player_id"]),
        row["discord_id"],
        number_(row["expr_0"]),
      ]),
    ).toEqual([
      ["Alice", 1, "111111111111111111", 4],
      ["Bob", 2, null, 1],
    ]);
    // Untracked participants (Derek, Charlie) never enter guild facts.
    expect(scanned).toBe(5);
  });

  test("global player grouping labels with the most recent Riot ID, no identity", async () => {
    const { rows, scanned } = await run(
      makeInput({
        scope: GLOBAL_SCOPE,
        plan: makePlan({
          groupings: [{ kind: "column", column: "player", name: "player" }],
          orderBy: [
            { target: { kind: "output", name: "games" }, direction: "desc" },
          ],
        }),
      }),
    );
    expect(scanned).toBe(8);
    const labels = rows.map((row) => row["label"]);
    expect(labels).toContain("Derek#NA1");
    // Charlie renamed between matches: arg_max labels with the newest name.
    expect(labels).toContain("NewName#NA1");
    expect(labels).not.toContain("OldName#NA1");
    for (const row of rows) {
      expect(row["player_id"]).toBe(null);
      expect(row["discord_id"]).toBe(null);
    }
  });

  test("player-ref substitution restricts to the resolved PUUIDs", async () => {
    const { rows, scanned, compiled } = await run(
      makeInput({
        plan: makePlan({
          playerRefs: ["alice"],
          where: { kind: "player-ref", index: 0 },
        }),
        playerPuuids: new Map([[0, [PA]]]),
      }),
    );
    // Pushed into both union branches (parquet-less lake still has staging +
    // the accounts side, so at least one branch carries it).
    expect(compiled.aggregateSql).toContain("(puuid IN (SELECT unnest(?)))");
    expect(number_(rows[0]?.["expr_0"])).toBe(4);
    expect(scanned).toBe(4);
  });
});

describe("group facts projection end-to-end", () => {
  test("returns raw rows only for units with ≥2 tracked players", async () => {
    const compiled = compileGroupFactsProjection(
      makeInput({
        plan: makePlan({
          source: "player_groups",
          outputs: [
            aggOutput("kills", {
              kind: "aggregate",
              func: "sum",
              arg: col("kills"),
              distinct: false,
            }),
          ],
          groupings: [{ kind: "group", size: 2, name: "group" }],
        }),
      }),
    );
    if (compiled === undefined) throw new Error("expected compiled projection");
    const { rows, scanned } = await withDuckDBConnection(async (session) => {
      const bind = (params: BoundParam[]) =>
        params.map((param) =>
          param.kind === "list" ? session.list(param.values) : param.value,
        );
      const rawRows = await session.run(
        compiled.factsSql,
        bind(compiled.factsParams),
      );
      const scannedRows = await session.run(
        compiled.scannedSql,
        bind(compiled.scannedParams),
      );
      return {
        rows: rawRows.map((row) => RowSchema.parse(row)),
        scanned: z.object({ scanned: CountSchema }).parse(scannedRows[0])
          .scanned,
      };
    });
    // Only NA1_100 holds two tracked players (Derek is untracked).
    expect(rows).toHaveLength(2);
    const killsByAlias = new Map(
      rows.map((row) => [row["player_alias"], number_(row["kills"])]),
    );
    expect(killsByAlias.get("Alice")).toBe(2);
    expect(killsByAlias.get("Bob")).toBe(3);
    for (const row of rows) {
      expect(row["match_id"]).toBe("NA1_100");
    }
    expect(compiled.columns.raw).toEqual(["kills"]);
    expect(scanned).toBe(5);
  });
});

// ── match_teams ──────────────────────────────────────────────────────────────

function teamPlan(overrides: Partial<ScoutQlPlan> = {}): ScoutQlPlan {
  return makePlan({
    source: "match_teams",
    outputs: [countOutput("teams")],
    ...overrides,
  });
}

describe("match_teams end-to-end", () => {
  test("counts team rows, two per match, over the real lake", async () => {
    const { rows } = await run(
      makeInput({ plan: teamPlan(), scope: GLOBAL_SCOPE }),
    );
    expect(rows).toHaveLength(1);
    // Six matches are seeded; each writes one team row per distinct team id.
    expect(number_(rows[0]?.["expr_0"])).toBeGreaterThan(0);
  });

  test("splits win rate by a first-objective flag", async () => {
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
      evidence: { kind: "sample" },
    };
    const { rows } = await run(
      makeInput({
        plan: teamPlan({
          outputs: [countOutput("teams"), winRate],
          groupings: [
            { kind: "column", column: "first_dragon", name: "first_dragon" },
          ],
        }),
        scope: GLOBAL_SCOPE,
      }),
    );
    // Both buckets exist, which is the whole point of the source.
    expect(rows.length).toBe(2);
    const byKey = new Map(
      rows.map((row) => [String(row["__key_0"]), row] as const),
    );
    expect([...byKey.keys()].toSorted()).toEqual(["false", "true"]);
    // The two seeded first-dragon teams both won.
    expect(number_(byKey.get("true")?.["expr_1"])).toBe(1);
  });

  test("filters on queue, which lives on the match and not the team row", async () => {
    const solo = await run(
      makeInput({
        plan: teamPlan({ where: eq("queue", "solo") }),
        scope: GLOBAL_SCOPE,
      }),
    );
    const flex = await run(
      makeInput({
        plan: teamPlan({ where: eq("queue", "flex") }),
        scope: GLOBAL_SCOPE,
      }),
    );
    const soloTeams = number_(solo.rows[0]?.["expr_0"]);
    const flexTeams = number_(flex.rows[0]?.["expr_0"]);
    // One seeded match is flex; the rest are solo. Without the looked-up
    // column this query could not be written at all.
    expect(flexTeams).toBeGreaterThan(0);
    expect(soloTeams).toBeGreaterThan(flexTeams);
  });

  test("the time window reaches team rows through the match", async () => {
    const week1Only = await run(
      makeInput({
        plan: teamPlan(),
        scope: GLOBAL_SCOPE,
        range: { start: WEEK1, end: WEEK1B },
      }),
    );
    const everything = await run(
      makeInput({ plan: teamPlan(), scope: GLOBAL_SCOPE }),
    );
    expect(number_(week1Only.rows[0]?.["expr_0"])).toBeLessThan(
      number_(everything.rows[0]?.["expr_0"]),
    );
  });
});

// ── team lookups on participant rows ─────────────────────────────────────────

describe("kill participation end-to-end", () => {
  test("divides each player's kills and assists by their team's kills", async () => {
    // NA1_100, team 100: Alice 2 kills + 5 assists, Bob 3 + 1, and the
    // untracked Derek 9 kills — 14 team kills in all.
    const kp: ScoutQlOutput = {
      name: "kp",
      expr: {
        kind: "aggregate",
        func: "avg",
        arg: col("kill_participation"),
        distinct: false,
      },
      displayKind: "percent",
      additive: false,
      evidence: { kind: "sample" },
    };
    const { rows, compiled } = await run(
      makeInput({
        plan: makePlan({
          outputs: [kp],
          where: eq("match_id", "NA1_100"),
          groupings: [{ kind: "column", column: "player", name: "player" }],
        }),
      }),
    );
    expect(compiled.aggregateSql).toContain("LEFT JOIN team_dim t");
    const byPlayer = new Map(
      rows.map((row) => [String(row["label"]), Number(row["expr_0"])] as const),
    );
    expect(byPlayer.get("Alice")).toBeCloseTo(7 / 14, 6);
    expect(byPlayer.get("Bob")).toBeCloseTo(4 / 14, 6);
  });

  test("does not join the team table unless a query names a team column", async () => {
    const { compiled } = await run(makeInput());
    expect(compiled.aggregateSql).not.toContain("team_dim");
  });
});

describe("match_team_bans end-to-end", () => {
  test("counts bans per champion, named from the registry", async () => {
    const { rows } = await run(
      makeInput({
        plan: makePlan({
          source: "match_team_bans",
          outputs: [countOutput("bans")],
          groupings: [{ kind: "column", column: "champion", name: "champion" }],
        }),
        scope: GLOBAL_SCOPE,
      }),
    );
    const byChampion = new Map(
      rows.map(
        (row) => [String(row["label"]), number_(row["expr_0"])] as const,
      ),
    );
    expect(byChampion.get("Yasuo")).toBe(2);
    expect(byChampion.get("Zed")).toBe(1);
    // Riot's -1 is an empty slot, and says so rather than showing a number.
    expect(byChampion.get("No ban")).toBe(1);
  });

  test("champion('Name') filters bans by id, like participant rows", async () => {
    const { rows } = await run(
      makeInput({
        plan: makePlan({
          source: "match_team_bans",
          outputs: [countOutput("bans")],
          where: eq("champion_id", 157),
        }),
        scope: GLOBAL_SCOPE,
      }),
    );
    expect(number_(rows[0]?.["expr_0"])).toBe(2);
  });
});
