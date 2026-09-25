import { beforeAll, describe, expect, test } from "vitest";
import type { ScoutQlOutput } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type {
  ScoutQlPredicate,
  ScoutQlScalarExpr,
  ScoutQlStreakMode,
} from "@scout-for-lol/data/model/scoutql/parse/expression.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";
import {
  writeTempTestLake,
  type TestLakeMatchFact,
} from "#src/testing/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import {
  col,
  COUNT_OUTPUT,
  eq,
  number_,
  runPlan,
  sourceInput,
} from "#src/testing/run-compiled-plan.ts";

/**
 * LONGEST_STREAK / CURRENT_STREAK, compiled and run against a seeded lake.
 *
 * Mira plays, an hour apart: W W L W W, an ARAM loss, then W. Rolf plays
 * two games that end at the same instant (NA1_R1 won, NA1_R2 lost), then
 * nothing. Kai owns two accounts: both play NA1_K1 and win, account A
 * wins NA1_K2, account B loses NA1_K3.
 */

const SERVER_ID = testGuildId("782");
const MIRA = testPuuid("streak-mira");
const ROLF = testPuuid("streak-rolf");
const KAI_A = testPuuid("streak-kai-a");
const KAI_B = testPuuid("streak-kai-b");
const START = Date.UTC(2026, 4, 1, 12);

function at(hour: number): Date {
  return new Date(START + hour * 3_600_000);
}

function game(
  player: Pick<TestLakeMatchFact, "playerId" | "playerAlias" | "puuid"> &
    Partial<TestLakeMatchFact>,
  played: { matchId: string; hour: number; win: boolean },
  extra: Partial<TestLakeMatchFact> = {},
): TestLakeMatchFact {
  return {
    ...player,
    matchId: played.matchId,
    queue: "solo",
    win: played.win,
    surrendered: false,
    kills: played.win ? 10 : 2,
    deaths: 3,
    assists: 4,
    gameCreationAt: at(played.hour),
    ...extra,
  };
}

const mira = { playerId: 1, playerAlias: "Mira", puuid: MIRA };
const rolf = { playerId: 2, playerAlias: "Rolf", puuid: ROLF };
// Each account has its own Riot ID; the server knows both as Kai.
const kaiA = {
  playerId: 3,
  playerAlias: "Kai",
  puuid: KAI_A,
  riotIdGameName: "KaiMain",
};
const kaiB = {
  playerId: 3,
  playerAlias: "Kai",
  puuid: KAI_B,
  riotIdGameName: "KaiAlt",
};

let files: LakeFiles;

beforeAll(async () => {
  files = await writeTempTestLake("scoutql-streaks-e2e-", {
    serverId: SERVER_ID,
    matchFacts: [
      game(mira, { matchId: "NA1_M1", hour: 0, win: true }),
      game(mira, { matchId: "NA1_M2", hour: 1, win: true }),
      game(mira, { matchId: "NA1_M3", hour: 2, win: false }),
      game(mira, { matchId: "NA1_M4", hour: 3, win: true }),
      game(mira, { matchId: "NA1_M5", hour: 4, win: true }),
      game(mira, { matchId: "NA1_M6", hour: 5, win: false }, { queue: "aram" }),
      game(mira, { matchId: "NA1_M7", hour: 6, win: true }),
      game(rolf, { matchId: "NA1_R1", hour: 0, win: true }),
      game(rolf, { matchId: "NA1_R2", hour: 0, win: false }),
      game(kaiA, { matchId: "NA1_K1", hour: 0, win: true }),
      game(kaiB, { matchId: "NA1_K1", hour: 0, win: true }, { teamId: 200 }),
      game(kaiA, { matchId: "NA1_K2", hour: 1, win: true }),
      game(kaiB, { matchId: "NA1_K3", hour: 2, win: false }),
    ],
  });
});

function streak(
  name: string,
  mode: ScoutQlStreakMode,
  arg: ScoutQlScalarExpr,
): ScoutQlOutput {
  return {
    name,
    expr: { kind: "streak", mode, arg },
    displayKind: "count",
    additive: false,
    evidence: { kind: "sample" },
  };
}

const WIN = col("win");
const LOSS: ScoutQlScalarExpr = {
  kind: "predicate",
  predicate: { kind: "not", operand: eq("win", true) },
};

/** Per-player streak values, keyed by the group label. */
async function byPlayer(input: {
  outputs: ScoutQlOutput[];
  where?: ScoutQlPredicate;
  tracked: boolean;
}): Promise<Map<string, number[]>> {
  const { rows, compiled } = await runPlan(
    sourceInput(
      files,
      {
        source: "match_participants",
        outputs: input.outputs,
        groupings: [{ kind: "column", column: "player", name: "player" }],
        ...(input.where === undefined ? {} : { where: input.where }),
      },
      input.tracked ? { scope: guildScope(SERVER_ID) } : {},
    ),
  );
  const result = new Map<string, number[]>();
  for (const row of rows) {
    result.set(
      String(row[compiled.columns.label]),
      compiled.columns.outputs.map((output) => number_(row[output.alias])),
    );
  }
  return result;
}

describe("streak aggregates", () => {
  test("longest and current runs, per player, in game order", async () => {
    const result = await byPlayer({
      outputs: [
        streak("longest", "longest", WIN),
        streak("current", "current", WIN),
        COUNT_OUTPUT,
      ],
      tracked: true,
    });
    // Mira: W W L W W L W. Rolf: W then L (R1 before R2 at the same end).
    // Kai: K1 once (two accounts, one game), K2 won, K3 lost. The row
    // count still sees all of Kai's rows.
    expect(Object.fromEntries(result)).toEqual({
      Mira: [2, 1, 7],
      Rolf: [1, 0, 2],
      Kai: [2, 0, 4],
    });
  });

  test("a game the WHERE removes is skipped, not a reset", async () => {
    const result = await byPlayer({
      outputs: [
        streak("longest", "longest", WIN),
        streak("current", "current", WIN),
      ],
      where: eq("queue", "solo"),
      tracked: true,
    });
    // Without the ARAM loss, Mira's solo games are W W L W W W.
    expect(result.get("Mira")).toEqual([3, 3]);
  });

  test("any boolean condition streaks: losses and big games", async () => {
    const tenKills: ScoutQlScalarExpr = {
      kind: "predicate",
      predicate: {
        kind: "compare",
        op: ">=",
        left: col("kills"),
        right: { kind: "literal", value: 10 },
      },
    };
    const result = await byPlayer({
      outputs: [
        streak("losses", "longest", LOSS),
        streak("big_games", "longest", tenKills),
        streak("current_losses", "current", LOSS),
      ],
      tracked: true,
    });
    expect(result.get("Mira")).toEqual([1, 2, 0]);
    expect(result.get("Rolf")).toEqual([1, 1, 1]);
  });

  test("global scope streaks each account on its own", async () => {
    const result = await byPlayer({
      outputs: [
        streak("longest", "longest", WIN),
        streak("current", "current", WIN),
      ],
      tracked: false,
    });
    // Global rows have no person, so Kai's accounts are two players:
    // A won K1 and K2; B won K1 and lost K3.
    expect(result.get("KaiMain#NA1")).toEqual([2, 2]);
    expect(result.get("KaiAlt#NA1")).toEqual([1, 0]);
    expect(result.size).toBe(4);
  });

  test("the same condition named twice compiles one window", async () => {
    const { compiled } = await runPlan(
      sourceInput(files, {
        source: "match_participants",
        outputs: [streak("a", "longest", WIN), streak("b", "current", WIN)],
      }),
    );
    expect(compiled.aggregateSql).toContain("__h_0");
    expect(compiled.aggregateSql).not.toContain("__h_1");
  });
});
