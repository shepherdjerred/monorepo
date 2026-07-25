import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  browseReportData,
  reportDataExplorerSchema,
  ReportDataBrowseInputSchema,
} from "#src/reports/data-explorer.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";

const lakeDir = resolveLakeDir();
const serverId = testGuildId("1337623164146155593");

beforeEach(async () => {
  await resetTestLake(lakeDir);
});

afterAll(async () => {
  await resetTestLake(lakeDir);
});

describe("report data explorer", () => {
  test("exposes only row-level ScoutQL sources", () => {
    expect(reportDataExplorerSchema().map((table) => table.id)).toEqual([
      "match_participants",
      "prematch_participants",
    ]);
  });

  test("bounds page size and filter count at the input boundary", () => {
    const base = {
      table: "match_participants",
      columns: ["player_alias"],
      filters: [],
      sort: null,
      cursor: null,
    };
    expect(
      ReportDataBrowseInputSchema.safeParse({ ...base, pageSize: 51 }).success,
    ).toBe(false);
    expect(
      ReportDataBrowseInputSchema.safeParse({
        ...base,
        pageSize: 25,
        filters: Array.from({ length: 6 }, () => ({
          column: "queue",
          operator: "eq",
          value: "solo",
        })),
      }).success,
    ).toBe(false);
  });

  test("rejects columns outside the selected table allowlist", async () => {
    await expect(
      browseReportData({
        serverId,
        input: ReportDataBrowseInputSchema.parse({
          table: "match_participants",
          columns: ["puuid"],
          filters: [],
          sort: null,
          cursor: null,
          pageSize: 25,
        }),
      }),
    ).rejects.toThrow("is not available");
  });

  test("browses filtered guild rows through the report lake", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        {
          playerId: 1,
          playerAlias: "Lux Player",
          matchId: "NA1_explorer_1",
          puuid: testPuuid("report-explorer-1"),
          queue: "solo",
          championId: 99,
          championName: "Lux",
          win: true,
          surrendered: false,
          kills: 8,
          deaths: 2,
          assists: 11,
          gameCreationAt: new Date("2026-07-12T12:00:00.000Z"),
        },
        {
          playerId: 2,
          playerAlias: "Ashe Player",
          matchId: "NA1_explorer_2",
          puuid: testPuuid("report-explorer-2"),
          queue: "aram",
          championName: "Ashe",
          win: false,
          surrendered: false,
          kills: 4,
          deaths: 7,
          assists: 9,
          gameCreationAt: new Date("2026-07-12T13:00:00.000Z"),
        },
      ],
    });

    const result = await browseReportData({
      serverId,
      input: ReportDataBrowseInputSchema.parse({
        table: "match_participants",
        columns: ["player_alias", "champion_name", "kills", "win"],
        filters: [{ column: "champion_name", operator: "eq", value: "Lux" }],
        sort: { column: "kills", direction: "desc" },
        cursor: null,
        pageSize: 25,
      }),
    });

    expect(result.rows).toEqual([
      {
        player_alias: "Lux Player",
        champion_name: "Lux",
        kills: 8,
        win: true,
      },
    ]);
    expect(result.nextCursor).toBeNull();
  });
});
