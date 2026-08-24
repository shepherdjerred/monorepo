import { describe, expect, test } from "vitest";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import type {
  ScoutQlGroupSize,
  ScoutQlPlan,
} from "@scout-for-lol/data/model/scoutql/plan.ts";
import { groupGameLevelColumns } from "#src/reports/duckdb/execute.ts";
import {
  aggregateFoldedGroups,
  foldGroupCombinations,
  type GroupFactRow,
} from "#src/reports/group-combinations.ts";
import type { PlanAggregateRow } from "#src/reports/plan-rows.ts";

/**
 * Teammate-group folding and the JS aggregation that stands in for SQL on this
 * source. The fold's contract is the catalog's own split: game-level columns
 * are carried, member-scoped counters are summed.
 */

const GAME_LEVEL = groupGameLevelColumns();

function fact(overrides: Partial<GroupFactRow> = {}): GroupFactRow {
  const values = new Map<string, string | number | boolean | null>([
    ["win", true],
    ["surrendered", false],
    ["queue", "solo"],
    ["game_duration_seconds", 1800],
    ["kills", 1],
    ["creep_score", 10],
    ["time_played", 1800],
  ]);
  return {
    playerId: 1,
    playerAlias: "P1",
    matchId: "NA1_1",
    teamId: 100,
    playerSubteamId: null,
    values,
    ...overrides,
  };
}

function withValues(
  base: GroupFactRow,
  overrides: Record<string, string | number | boolean | null>,
): GroupFactRow {
  const values = new Map(base.values);
  for (const [name, override] of Object.entries(overrides)) {
    values.set(name, override);
  }
  return { ...base, values };
}

function stack(
  matchId: string,
  count: number,
  overrides: Record<string, string | number | boolean | null> = {},
): GroupFactRow[] {
  return Array.from({ length: count }, (_, index) =>
    withValues(
      fact({
        matchId,
        playerId: index + 1,
        playerAlias: `P${(index + 1).toString()}`,
      }),
      overrides,
    ),
  );
}

const QUERY_OUTPUTS =
  "COUNT(*) AS games, COUNT(*) FILTER (WHERE win) AS wins, " +
  "COUNT(*) FILTER (WHERE surrendered) AS surrenders, SUM(kills) AS kills, " +
  "SUM(creep_score) AS cs, SUM(time_played) AS played, " +
  "AVG(game_duration_seconds) AS length";

function aggregate(
  facts: GroupFactRow[],
  size: ScoutQlGroupSize,
  tail = "",
): PlanAggregateRow[] {
  const plan = compileScoutQl(
    `SELECT ${QUERY_OUTPUTS} FROM player_groups GROUP BY group(${size.toString()})${tail}`,
  );
  return aggregateFoldedGroups({
    plan,
    groups: foldGroupCombinations({
      facts,
      size,
      gameLevelColumns: GAME_LEVEL,
    }),
    gameLevelColumns: GAME_LEVEL,
    limit: 1000,
  });
}

function value(row: PlanAggregateRow | undefined, name: string): unknown {
  return row?.outputs.find((output) => output.name === name)?.value;
}

describe("teammate-group folding", () => {
  test("group(2) on a 5-stack yields all C(5,2)=10 pairs", () => {
    const rows = aggregate(stack("NA1_1", 5), 2);
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => value(row, "games") === 1)).toBe(true);
  });

  test("group(3) on a 5-stack sums member counters and carries game facts", () => {
    const rows = aggregate(stack("NA1_1", 5), 3);
    expect(rows).toHaveLength(10);
    const trio = rows.find((row) => row.label === "P1 + P2 + P3");
    expect(value(trio, "kills")).toBe(3);
    expect(value(trio, "cs")).toBe(30);
    // Member-scoped: three members' time played.
    expect(value(trio, "played")).toBe(5400);
    // Game-level: one game's duration, not three.
    expect(value(trio, "length")).toBe(1800);
  });

  test("group(all) on a 5-stack yields every size 2..5", () => {
    const rows = aggregate(stack("NA1_1", 5), "all");
    // C(5,2)+C(5,3)+C(5,4)+C(5,5) = 10+10+5+1
    expect(rows).toHaveLength(26);
    const full = rows.find((row) => row.label === "P1 + P2 + P3 + P4 + P5");
    expect(value(full, "games")).toBe(1);
  });

  test("group members share one team, so win and surrender are the game's", () => {
    const rows = aggregate(
      [
        withValues(fact({ playerId: 1, playerAlias: "P1" }), {
          win: false,
          surrendered: true,
        }),
        withValues(fact({ playerId: 2, playerAlias: "P2" }), {
          win: false,
          surrendered: true,
        }),
      ],
      2,
    );
    expect(rows).toHaveLength(1);
    expect(value(rows[0], "wins")).toBe(0);
    expect(value(rows[0], "surrenders")).toBe(1);
  });

  test("Arena: same team side never pairs across subteams", () => {
    const rows = aggregate(
      [
        fact({ playerId: 1, playerAlias: "P1", playerSubteamId: 1 }),
        fact({ playerId: 2, playerAlias: "P2", playerSubteamId: 1 }),
        fact({ playerId: 3, playerAlias: "P3", playerSubteamId: 2 }),
        fact({ playerId: 4, playerAlias: "P4", playerSubteamId: 2 }),
      ],
      2,
    );
    expect(rows.map((row) => row.label).toSorted()).toEqual([
      "P1 + P2",
      "P3 + P4",
    ]);
  });

  test("Arena: a 3-person subteam under group(all) yields 3 pairs + 1 trio", () => {
    const rows = aggregate(
      [
        fact({ playerId: 1, playerAlias: "P1", playerSubteamId: 3 }),
        fact({ playerId: 2, playerAlias: "P2", playerSubteamId: 3 }),
        fact({ playerId: 3, playerAlias: "P3", playerSubteamId: 3 }),
      ],
      "all",
    );
    expect(rows).toHaveLength(4);
    expect(
      rows.filter((row) => row.label.split(" + ").length === 2),
    ).toHaveLength(3);
    expect(
      rows.filter((row) => row.label.split(" + ").length === 3),
    ).toHaveLength(1);
  });

  test("accumulates the same tuple across matches", () => {
    const rows = aggregate(
      [
        ...stack("NA1_1", 2, { win: true }),
        ...stack("NA1_2", 2, { win: false }),
      ],
      2,
    );
    expect(rows).toHaveLength(1);
    expect(value(rows[0], "games")).toBe(2);
    expect(value(rows[0], "wins")).toBe(1);
  });

  test("dedupes multi-account players within a unit (last fact wins)", () => {
    const rows = aggregate(
      [
        withValues(fact({ playerId: 1, playerAlias: "P1" }), { kills: 1 }),
        withValues(fact({ playerId: 1, playerAlias: "P1" }), { kills: 9 }),
        withValues(fact({ playerId: 2, playerAlias: "P2" }), { kills: 5 }),
      ],
      2,
    );
    expect(rows).toHaveLength(1);
    expect(value(rows[0], "kills")).toBe(14);
  });

  test("requested size larger than the roster yields nothing", () => {
    expect(aggregate(stack("NA1_1", 2), 4)).toHaveLength(0);
  });

  test("HAVING, ORDER BY and LIMIT run over the folded rows", () => {
    const facts = [
      ...stack("NA1_1", 2),
      ...stack("NA1_2", 2),
      ...stack("NA1_3", 3).slice(2),
    ];
    const plan = compileScoutQl(
      `SELECT ${QUERY_OUTPUTS} FROM player_groups GROUP BY group(2) HAVING games >= 2 ORDER BY kills DESC`,
    );
    const rows = aggregateFoldedGroups({
      plan,
      groups: foldGroupCombinations({
        facts,
        size: 2,
        gameLevelColumns: GAME_LEVEL,
      }),
      gameLevelColumns: GAME_LEVEL,
      limit: 1000,
    });
    expect(rows.map((row) => row.label)).toEqual(["P1 + P2"]);
    expect(value(rows[0], "games")).toBe(2);
  });

  test("perf sanity: 10k full 5-stack units under group(all)", () => {
    const facts: GroupFactRow[] = [];
    for (let matchIndex = 0; matchIndex < 10_000; matchIndex++) {
      // 20 rotating rosters so distinct tuples accumulate real game counts.
      const base = (matchIndex % 20) * 5;
      for (let member = 0; member < 5; member++) {
        facts.push(
          fact({
            matchId: `NA1_${matchIndex.toString()}`,
            playerId: base + member + 1,
            playerAlias: `P${(base + member + 1).toString()}`,
          }),
        );
      }
    }
    const startedAt = performance.now();
    const rows = aggregate(facts, "all");
    const elapsedMs = performance.now() - startedAt;
    // 20 rosters × 26 combinations each.
    expect(rows).toHaveLength(520);
    expect(elapsedMs).toBeLessThan(4000);
  });
});

describe("aggregates a teammate group cannot answer", () => {
  test("COUNT(DISTINCT …) is refused at compile time, not at execution", () => {
    // A teammate-group row is already a fold of several member rows by the
    // time aggregate-eval.ts would see it, so the distinct values COUNT
    // needs are gone — this used to compile and only fail once
    // `aggregateFoldedGroups` actually ran it. Rejecting in the analyzer
    // means `validate_report_query` (and thus preview/schedule) can never
    // approve a report that is guaranteed to fail.
    expect(() =>
      compileScoutQl(
        "SELECT COUNT(DISTINCT queue) AS queues FROM player_groups GROUP BY group(2)",
      ),
    ).toThrow(/COUNT\(DISTINCT/u);
  });

  test("a FILTER on a member-scoped counter is refused with a reason", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS games FROM player_groups GROUP BY group(2)",
    );
    // The analyzer rejects this spelling outright (kills is not WHERE-able on
    // this source), so the engine's own guard is exercised on a hand-built
    // filter — the last line of defence if that rule ever loosens.
    const memberScoped: ScoutQlPlan = {
      ...plan,
      outputs: [
        {
          name: "games",
          displayKind: "count",
          additive: true,
          evidence: { kind: "sample" },
          expr: {
            kind: "count-star",
            filter: {
              kind: "compare",
              op: ">",
              left: { kind: "column", column: "kills" },
              right: { kind: "literal", value: 0 },
            },
          },
        },
      ],
    };
    expect(() =>
      aggregateFoldedGroups({
        plan: compileScoutQl(
          "SELECT COUNT(*) AS games FROM player_groups GROUP BY group(2)",
        ),
        groups: foldGroupCombinations({
          facts: stack("NA1_1", 2),
          size: 2,
          gameLevelColumns: GAME_LEVEL,
        }),
        gameLevelColumns: GAME_LEVEL,
        limit: 10,
      }),
    ).not.toThrow();
    expect(() =>
      aggregateFoldedGroups({
        plan: memberScoped,
        groups: foldGroupCombinations({
          facts: stack("NA1_1", 2),
          size: 2,
          gameLevelColumns: GAME_LEVEL,
        }),
        gameLevelColumns: GAME_LEVEL,
        limit: 10,
      }),
    ).toThrow(/game-level columns/u);
  });
});
