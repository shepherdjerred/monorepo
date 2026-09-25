import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { ITEM_SLOT_COLUMNS } from "@scout-for-lol/data/model/reports/lake-columns.ts";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { ScoutQlOutput } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { writeTempTestLake } from "#src/testing/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import {
  and,
  avgOf,
  col,
  COUNT_OUTPUT,
  eq,
  number_,
  outputsByLabel,
  runPlan,
  sourceInput,
} from "#src/testing/run-compiled-plan.ts";

/**
 * match_items, compiled and run against a seeded lake.
 *
 * Mira plays three games of Jinx:
 *   M1 won holding Infinity Edge (3031), Long Sword (1036) and a Stealth
 *      Ward trinket (3340), with empty slots between;
 *   M2 lost holding Infinity Edge and an item newer than Scout's data;
 *   M3 won in Arena holding Arena's Infinity Edge (223031).
 */

const SERVER_ID = testGuildId("784");
const MIRA = testPuuid("items-mira");
const START = Date.UTC(2026, 4, 3, 12);
const UNKNOWN_ITEM = 999_999;

const mira = { playerId: 1, playerAlias: "Mira", puuid: MIRA };

function game(
  matchId: string,
  hour: number,
  outcome: { win: boolean; items: number[] },
) {
  return {
    ...mira,
    matchId,
    queue: "solo",
    win: outcome.win,
    surrendered: false,
    kills: 1,
    deaths: 1,
    assists: 1,
    championId: 222,
    championName: "Jinx",
    items: outcome.items,
    gameCreationAt: new Date(START + hour * 3_600_000),
  };
}

let files: LakeFiles;

beforeAll(async () => {
  files = await writeTempTestLake("scoutql-items-e2e-", {
    serverId: SERVER_ID,
    matchFacts: [
      game("NA1_M1", 0, { win: true, items: [3031, 0, 1036, 0, 0, 0, 3340] }),
      game("NA1_M2", 1, { win: false, items: [3031, UNKNOWN_ITEM] }),
      game("NA1_M3", 2, { win: true, items: [0, 223_031] }),
    ],
  });
});

const GAMES: ScoutQlOutput = {
  name: "games",
  expr: {
    kind: "aggregate",
    func: "count",
    arg: col("match_id"),
    distinct: true,
  },
  displayKind: "count",
  additive: false,
  evidence: { kind: "sample" },
};

function items(plan: Partial<ScoutQlPlan>) {
  return sourceInput(
    files,
    { source: "match_items", ...plan },
    { scope: guildScope(SERVER_ID) },
  );
}

describe("match_items", () => {
  test("one row per held item, named, across modes", async () => {
    const result = await outputsByLabel(
      items({
        outputs: [
          GAMES,
          avgOf({ kind: "cast", to: "int", operand: col("win") }),
        ],
        groupings: [{ kind: "column", column: "item", name: "item" }],
      }),
    );
    // Arena's reissue counts as Infinity Edge; the unknown item has no name.
    expect(result).toEqual({
      "Infinity Edge": [3, 2 / 3],
      "Long Sword": [1, 1],
      "Stealth Ward": [1, 1],
      unknown: [1, 0],
    });
  });

  test("tiers and slots", async () => {
    const result = await outputsByLabel(
      items({
        outputs: [GAMES],
        where: eq("slot", 6),
        groupings: [{ kind: "column", column: "item_tier", name: "tier" }],
      }),
    );
    expect(result).toEqual({ trinket: [1] });
  });

  test("item('…') folds to the id, the base id for a mode's reissue", async () => {
    const result = await outputsByLabel(
      items({
        outputs: [
          GAMES,
          avgOf({ kind: "cast", to: "int", operand: col("win") }),
        ],
        where: and(eq("item_id", 3031), eq("champion_name", "Jinx")),
      }),
    );
    expect(Object.values(result)).toEqual([[3, 2 / 3]]);
  });
});

describe("a lake built before the inventory slots existed", () => {
  // A deploy that adds the slots publishes before the rebuild does. Reads
  // that do not need them must keep working over the old files meanwhile.
  let oldFiles: LakeFiles;

  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scoutql-items-old-"));
    const parquet = path.join(dir, "matches.parquet");
    await withDuckDBConnection(async (session) => {
      await session.run(
        `COPY (SELECT * EXCLUDE (${ITEM_SLOT_COLUMNS.join(", ")}) FROM read_json(?, format='newline_delimited')) TO '${parquet}' (FORMAT PARQUET)`,
        [session.list(files.matchesStaging)],
      );
    });
    oldFiles = { ...files, matchesParquet: [parquet], matchesStaging: [] };
  });

  test("match_participants still reads it", async () => {
    const { rows } = await runPlan(
      sourceInput(
        oldFiles,
        { source: "match_participants", outputs: [COUNT_OUTPUT] },
        { scope: guildScope(SERVER_ID) },
      ),
    );
    expect(rows.map((row) => number_(row["expr_0"]))).toEqual([3]);
  });

  test("match_items fails loudly until the rebuild publishes", async () => {
    await expect(
      runPlan(
        sourceInput(
          oldFiles,
          { source: "match_items", outputs: [GAMES] },
          { scope: guildScope(SERVER_ID) },
        ),
      ),
    ).rejects.toThrow(/item0/);
  });
});
