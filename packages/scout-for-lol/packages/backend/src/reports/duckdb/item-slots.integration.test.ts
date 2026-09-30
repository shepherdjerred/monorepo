import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import {
  ITEM_SLOT_COLUMNS,
  matchReadColumns,
} from "@scout-for-lol/data/model/reports/lake-columns.ts";
import { MATCH_REBUILD_GATED_COLUMNS } from "@scout-for-lol/data/model/reports/match-rebuild-gated-columns.ts";
import { MATCH_UI_READ_COLUMNS } from "#src/report-lake/loadout.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { writeTempTestLake } from "#src/testing/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import {
  COUNT_OUTPUT,
  number_,
  runPlan,
  sourceInput,
} from "#src/testing/run-compiled-plan.ts";

/**
 * New inventory, spell, rune, and augment fields arrive with lake schema
 * changes. Ordinary match reads omit these until a rebuild publishes.
 */

const SERVER_ID = testGuildId("784");
const START = Date.UTC(2026, 4, 3, 12);

let files: LakeFiles;

beforeAll(async () => {
  const seeded = await writeTempTestLake("scoutql-item-slots-", {
    serverId: SERVER_ID,
    matchFacts: [0, 1, 2].map((hour) => ({
      playerId: 1,
      playerAlias: "Mira",
      puuid: testPuuid("item-slots-mira"),
      matchId: `NA1_S${hour.toString()}`,
      queue: "solo",
      win: hour !== 1,
      surrendered: false,
      kills: 1,
      deaths: 1,
      assists: 1,
      items: [3031, 1036],
      gameCreationAt: new Date(START + hour * 3_600_000),
    })),
  });
  const dir = await mkdtemp(path.join(tmpdir(), "scoutql-item-slots-old-"));
  const parquet = path.join(dir, "matches.parquet");
  await withDuckDBConnection(async (session) => {
    await session.run(
      `COPY (SELECT * EXCLUDE (${[...ITEM_SLOT_COLUMNS, ...MATCH_REBUILD_GATED_COLUMNS].join(", ")}) FROM read_json(?, format='newline_delimited')) TO '${parquet}' (FORMAT PARQUET)`,
      [session.list(seeded.matchesStaging)],
    );
  });
  files = { ...seeded, matchesParquet: [parquet], matchesStaging: [] };
});

describe("a lake built before the inventory slots existed", () => {
  test("match_participants still reads it", async () => {
    const { rows } = await runPlan(
      sourceInput(
        files,
        { source: "match_participants", outputs: [COUNT_OUTPUT] },
        { scope: guildScope(SERVER_ID) },
      ),
    );
    expect(rows.map((row) => number_(row["expr_0"]))).toEqual([3]);
  });
});

test("match UI reads only its requested rebuilt columns", () => {
  const ordinary = matchReadColumns([]);
  const ui = matchReadColumns(MATCH_UI_READ_COLUMNS);

  expect(ordinary).not.toHaveProperty("item0");
  expect(ordinary).not.toHaveProperty("summoner_spell_1_id");
  expect(ui).toHaveProperty("item0");
  expect(ui).toHaveProperty("summoner_spell_1_id");
  expect(ui).toHaveProperty("augment_1_id");
  expect(ui).not.toHaveProperty("summoner1_id");
});
