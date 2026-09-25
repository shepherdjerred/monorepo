import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { executeReportQuery } from "#src/reports/query/query-engine.ts";
import { GLOBAL_SCOPE } from "#src/reports/duckdb/scope.ts";

/**
 * Grouping keys that are not plain text, run through the whole query engine:
 * a boolean key echoed as an output, and a position Riot sends as an empty
 * string. Both used to fail or mislabel whole queries in production data.
 */

const { prisma } = createTestDatabase("report-grouping-keys-test");
const serverId = testGuildId("737373");
const now = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
const lakeDir = resolveLakeDir();

function fact(
  matchId: string,
  alias: string,
  extra: { win: boolean; teamId: number; teamPosition?: string },
) {
  return {
    playerId: 1,
    playerAlias: alias,
    matchId,
    puuid: testPuuid(`keys-${alias}`),
    queue: "solo",
    surrendered: false,
    kills: 1,
    deaths: 1,
    assists: 1,
    gameCreationAt: now,
    ...extra,
  };
}

function column(
  row: { values: { column: string; value: unknown }[] } | undefined,
  name: string,
): unknown {
  return row?.values.find((value) => value.column === name)?.value;
}

beforeEach(async () => {
  await resetTestLake(lakeDir);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("grouping keys", () => {
  test("a boolean key can be echoed as an output", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        {
          ...fact("NA1_1", "Blue", { win: true, teamId: 100 }),
          firstDragon: true,
        },
      ],
      untrackedMatchFacts: [fact("NA1_1", "Red", { win: false, teamId: 200 })],
    });

    const result = await executeReportQuery({
      prisma,
      scope: GLOBAL_SCOPE,
      queryText:
        "SELECT first_dragon, COUNT(*) AS teams FROM match_teams WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY first_dragon",
      now,
    });

    const byKey = new Map(
      result.rows.map((row) => [
        String(column(row, "first_dragon")),
        column(row, "teams"),
      ]),
    );
    expect(byKey).toEqual(
      new Map([
        ["true", 1],
        ["false", 1],
      ]),
    );
  });

  test("an empty position groups as unknown, not as a blank label", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact("NA1_1", "Mid", {
          win: true,
          teamId: 100,
          teamPosition: "MIDDLE",
        }),
        // ARAM and Arena rows carry '' rather than NULL.
        fact("NA1_2", "Aram", { win: true, teamId: 100, teamPosition: "" }),
      ],
    });

    const result = await executeReportQuery({
      prisma,
      scope: GLOBAL_SCOPE,
      queryText:
        "SELECT COUNT(*) AS games FROM match_participants WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY GROUP BY team_position",
      now,
    });

    expect(result.rows.map((row) => row.label).toSorted()).toEqual([
      "MIDDLE",
      "unknown",
    ]);
  });
});
