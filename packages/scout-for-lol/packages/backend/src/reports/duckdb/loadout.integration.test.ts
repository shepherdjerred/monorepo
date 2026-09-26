import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import { LOADOUT_COLUMNS } from "@scout-for-lol/data/model/reports/lake-columns.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  writeTempTestLake,
  type TestLakeMatchFact,
} from "#src/testing/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import {
  avgOf,
  col,
  COUNT_OUTPUT,
  eq,
  number_,
  runPlan,
  sourceInput,
} from "#src/testing/run-compiled-plan.ts";

/**
 * Loadout columns (items, summoner spells, runes) on a seeded lake.
 *
 * Mira plays three games. G1 and G2 are Conqueror with Flash + Ignite (G2
 * with the spells on the other keys); G3 is Electrocute with Flash +
 * Teleport. G1 won holding Infinity Edge and a Long Sword.
 */

const SERVER_ID = testGuildId("784");
const START = Date.UTC(2026, 4, 3, 12);

function game(
  hour: number,
  overrides: Partial<TestLakeMatchFact>,
): TestLakeMatchFact {
  return {
    playerId: 1,
    playerAlias: "Mira",
    puuid: testPuuid("loadout-mira"),
    matchId: `NA1_L${hour.toString()}`,
    queue: "solo",
    win: false,
    surrendered: false,
    kills: 1,
    deaths: 1,
    assists: 1,
    gameCreationAt: new Date(START + hour * 3_600_000),
    ...overrides,
  };
}

let files: LakeFiles;

beforeAll(async () => {
  files = await writeTempTestLake("scoutql-loadout-", {
    serverId: SERVER_ID,
    matchFacts: [
      game(0, { win: true, items: [1036, 0, 3031] }),
      game(1, { loadout: { summoner1_id: 14, summoner2_id: 4 } }),
      game(2, {
        win: true,
        loadout: {
          summoner2_id: 12,
          perk_primary_style: 8100,
          perk0: 8112,
        },
      }),
    ],
  });
});

function query(plan: Partial<ScoutQlPlan>, lake: LakeFiles = files) {
  return runPlan(
    sourceInput(
      lake,
      { source: "match_participants", ...plan },
      { scope: guildScope(SERVER_ID) },
    ),
  );
}

async function byLabel(plan: Partial<ScoutQlPlan>) {
  const { rows, compiled } = await query(plan);
  return Object.fromEntries(
    rows.map((row) => [
      String(row[compiled.columns.label]),
      compiled.columns.outputs.map((output) => number_(row[output.alias])),
    ]),
  );
}

const WIN_RATE = avgOf({ kind: "cast", to: "int", operand: col("win") });

describe("loadout columns", () => {
  test("keystone win rates, by name", async () => {
    const result = await byLabel({
      outputs: [COUNT_OUTPUT, WIN_RATE],
      groupings: [{ kind: "column", column: "keystone", name: "keystone" }],
    });
    expect(result).toEqual({ Conqueror: [2, 0.5], Electrocute: [1, 1] });
  });

  test("a spell pair reads the same on either key", async () => {
    const result = await byLabel({
      outputs: [COUNT_OUTPUT],
      groupings: [{ kind: "column", column: "spells", name: "spells" }],
    });
    expect(result).toEqual({ "Flash + Ignite": [2], "Flash + Teleport": [1] });
  });

  test("the final build, as names in name order", async () => {
    const result = await byLabel({
      outputs: [COUNT_OUTPUT],
      where: eq("win", true),
      groupings: [{ kind: "column", column: "items", name: "items" }],
    });
    // G3 held nothing, so its build has no name.
    expect(result).toEqual({ "Infinity Edge + Long Sword": [1], unknown: [1] });
  });

  test("a raw id filters like any column", async () => {
    const { rows } = await query({
      outputs: [COUNT_OUTPUT],
      where: eq("perk0", 8112),
    });
    expect(rows.map((row) => number_(row["expr_0"]))).toEqual([1]);
  });
});

describe("a lake built before the loadout columns existed", () => {
  // A deploy that adds them publishes before the rebuild that writes them.
  // Reads that do not name them must keep working meanwhile.
  let oldFiles: LakeFiles;

  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "scoutql-loadout-old-"));
    const parquet = path.join(dir, "matches.parquet");
    await withDuckDBConnection(async (session) => {
      await session.run(
        `COPY (SELECT * EXCLUDE (${LOADOUT_COLUMNS.join(", ")}) FROM read_json(?, format='newline_delimited')) TO '${parquet}' (FORMAT PARQUET)`,
        [session.list(files.matchesStaging)],
      );
    });
    oldFiles = { ...files, matchesParquet: [parquet], matchesStaging: [] };
  });

  test("an ordinary query still reads it", async () => {
    const { rows } = await query({ outputs: [COUNT_OUTPUT] }, oldFiles);
    expect(rows.map((row) => number_(row["expr_0"]))).toEqual([3]);
  });

  test("a query naming a loadout column fails loudly until the rebuild", async () => {
    await expect(
      query(
        {
          outputs: [COUNT_OUTPUT],
          groupings: [{ kind: "column", column: "keystone", name: "keystone" }],
        },
        oldFiles,
      ),
    ).rejects.toThrow(/perk0/);
  });
});
