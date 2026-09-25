import { beforeAll, describe, expect, test } from "vitest";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";
import { ScopeRefusedError } from "#src/reports/duckdb/plan-source.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";
import {
  writeTempTestLake,
  type TestLakeMatchFact,
} from "#src/testing/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import {
  and,
  avgOf,
  col,
  COUNT_OUTPUT,
  eq,
  number_,
  runPlan,
  sourceInput,
} from "#src/testing/run-compiled-plan.ts";
import { compileScoutQlPlanQuery } from "#src/reports/duckdb/compile-plan.ts";

/**
 * match_pairs, compiled and run against a seeded lake.
 *
 * Gex and Lolo are tracked; Otto and Pia are not. Four games:
 *   G1: Gex (mid) + Lolo (bot) win against Otto (mid) + Pia (top).
 *   G2: Gex (mid) + Pia (top) lose to Otto (mid).
 *   G3: Gex (mid) + Lolo (bot) win against Otto (bot).
 *   G4: Lolo (bot) wins against Otto (bot).
 */

const SERVER_ID = testGuildId("783");
const GEX = testPuuid("pairs-gex");
const LOLO = testPuuid("pairs-lolo");
const OTTO = testPuuid("pairs-otto");
const PIA = testPuuid("pairs-pia");
const START = Date.UTC(2026, 4, 2, 12);

type Seat = {
  playerId: number;
  playerAlias: string;
  puuid: string;
  teamId: number;
  teamPosition: string;
  win: boolean;
};

const gex = { playerId: 1, playerAlias: "Gex", puuid: GEX };
const lolo = { playerId: 2, playerAlias: "Lolo", puuid: LOLO };
const otto = { playerId: 8, playerAlias: "Otto", puuid: OTTO };
const pia = { playerId: 9, playerAlias: "Pia", puuid: PIA };

function seat(
  player: typeof gex,
  side: { teamId: number; teamPosition: string; win: boolean },
): Seat {
  return { ...player, ...side };
}

const BLUE_WIN = { teamId: 100, win: true };
const BLUE_LOSS = { teamId: 100, win: false };
const RED_WIN = { teamId: 200, win: true };
const RED_LOSS = { teamId: 200, win: false };

const GAMES: { matchId: string; hour: number; seats: Seat[] }[] = [
  {
    matchId: "NA1_G1",
    hour: 0,
    seats: [
      seat(gex, { ...BLUE_WIN, teamPosition: "MIDDLE" }),
      seat(lolo, { ...BLUE_WIN, teamPosition: "BOTTOM" }),
      seat(otto, { ...RED_LOSS, teamPosition: "MIDDLE" }),
      seat(pia, { ...RED_LOSS, teamPosition: "TOP" }),
    ],
  },
  {
    matchId: "NA1_G2",
    hour: 1,
    seats: [
      seat(gex, { ...BLUE_LOSS, teamPosition: "MIDDLE" }),
      seat(pia, { ...BLUE_LOSS, teamPosition: "TOP" }),
      seat(otto, { ...RED_WIN, teamPosition: "MIDDLE" }),
    ],
  },
  {
    matchId: "NA1_G3",
    hour: 2,
    seats: [
      seat(gex, { ...BLUE_WIN, teamPosition: "MIDDLE" }),
      seat(lolo, { ...BLUE_WIN, teamPosition: "BOTTOM" }),
      seat(otto, { ...RED_LOSS, teamPosition: "BOTTOM" }),
    ],
  },
  {
    matchId: "NA1_G4",
    hour: 3,
    seats: [
      seat(lolo, { ...BLUE_WIN, teamPosition: "BOTTOM" }),
      seat(otto, { ...RED_LOSS, teamPosition: "BOTTOM" }),
    ],
  },
];

const TRACKED = new Set([GEX, LOLO]);

function facts(tracked: boolean): TestLakeMatchFact[] {
  return GAMES.flatMap((game) =>
    game.seats
      .filter((s) => TRACKED.has(s.puuid) === tracked)
      .map((s): TestLakeMatchFact => ({
        ...s,
        matchId: game.matchId,
        queue: "solo",
        surrendered: false,
        kills: 1,
        deaths: 1,
        assists: 1,
        gameCreationAt: new Date(START + game.hour * 3_600_000),
      })),
  );
}

let files: LakeFiles;

beforeAll(async () => {
  files = await writeTempTestLake("scoutql-pairs-e2e-", {
    serverId: SERVER_ID,
    matchFacts: facts(true),
    untrackedMatchFacts: facts(false),
  });
});

/** player('Gex') is ref 0; other('Otto') is ref 1 when a test names it. */
const REFS = new Map([
  [0, [GEX]],
  [1, [OTTO]],
]);

function pairs(plan: Partial<ScoutQlPlan>) {
  return sourceInput(
    files,
    { source: "match_pairs", playerRefs: ["Gex", "Otto"], ...plan },
    { playerPuuids: REFS },
  );
}

const GEX_REF = { kind: "player-ref", index: 0 } as const;
const OTTO_REF = { kind: "player-ref", index: 1, side: "other" } as const;

async function byLabel(
  input: ReturnType<typeof pairs>,
): Promise<Record<string, number[]>> {
  const { rows, compiled } = await runPlan(input);
  return Object.fromEntries(
    rows.map((row) => [
      String(row[compiled.columns.label]),
      compiled.columns.outputs.map((output) => number_(row[output.alias])),
    ]),
  );
}

describe("match_pairs", () => {
  test("a player's teammates, tracked or not, with their record together", async () => {
    const result = await byLabel(
      pairs({
        outputs: [
          COUNT_OUTPUT,
          avgOf({ kind: "cast", to: "int", operand: col("win") }),
        ],
        where: and(GEX_REF, eq("relation", "teammate")),
        groupings: [{ kind: "column", column: "other", name: "other" }],
      }),
    );
    expect(result).toEqual({ "Lolo#NA1": [2, 1], "Pia#NA1": [1, 0] });
  });

  test("head-to-head: one player against another", async () => {
    const result = await byLabel(
      pairs({
        outputs: [
          COUNT_OUTPUT,
          avgOf({ kind: "cast", to: "int", operand: col("win") }),
        ],
        where: and(GEX_REF, OTTO_REF, eq("relation", "opponent")),
      }),
    );
    // G1 and G3 won, G2 lost; G4 is not Gex's game.
    expect(Object.values(result)).toEqual([[3, 2 / 3]]);
  });

  test("the lane matchup is the opponent in the same position", async () => {
    const result = await byLabel(
      pairs({
        outputs: [COUNT_OUTPUT],
        where: and(GEX_REF, eq("is_lane_opponent", true)),
        groupings: [{ kind: "column", column: "other", name: "other" }],
      }),
    );
    // Otto was mid in G1 and G2, bot in G3.
    expect(result).toEqual({ "Otto#NA1": [2] });
  });

  test("a server's scope pairs its own players with anyone", async () => {
    const result = await byLabel(
      sourceInput(
        files,
        {
          source: "match_pairs",
          outputs: [COUNT_OUTPUT],
          where: eq("relation", "teammate"),
          groupings: [
            { kind: "column", column: "player", name: "player" },
            { kind: "column", column: "other", name: "other" },
          ],
        },
        { scope: guildScope(SERVER_ID) },
      ),
    );
    // Pia is untracked, so never the row's own player here.
    expect(result).toEqual({
      "Gex • Lolo#NA1": [2],
      "Gex • Pia#NA1": [1],
      "Lolo • Gex#NA1": [2],
    });
  });

  test("global scope without a named player is refused", () => {
    expect(() =>
      compileScoutQlPlanQuery(
        sourceInput(files, {
          source: "match_pairs",
          where: eq("relation", "teammate"),
        }),
      ),
    ).toThrow(ScopeRefusedError);
  });
});
