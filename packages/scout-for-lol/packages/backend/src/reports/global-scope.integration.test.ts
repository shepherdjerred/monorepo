import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";
import { GLOBAL_SCOPE, guildScope } from "#src/reports/duckdb/scope.ts";

/**
 * Global scope: the explore surface queries every participant of every
 * ingested match rather than one server's tracked accounts.
 *
 * The property worth guarding hardest is the first test below. Accounts rows
 * are written per (server_id, account), so an accounts join with the
 * server_id predicate merely removed matches a PUUID once per server tracking
 * it and doubles every aggregate — silently, and only for the subset of
 * players tracked in more than one server. Global scope avoids it by not
 * joining accounts at all.
 */

const { prisma } = createTestDatabase("report-global-scope-test");
const serverId = testGuildId("919191");
const otherServerId = testGuildId("828282");
const now = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
const lakeDir = resolveLakeDir();

const TRACKED_PUUID = testPuuid("global-tracked");

function trackedMatch(matchId: string, win: boolean) {
  return {
    playerId: 1,
    playerAlias: "Tracked Player",
    matchId,
    puuid: TRACKED_PUUID,
    queue: "solo",
    win,
    surrendered: false,
    kills: 5,
    deaths: 2,
    assists: 7,
    gameCreationAt: now,
  };
}

/** A participant Scout has match rows for but no account row. */
function untrackedMatch(matchId: string, alias: string, win: boolean) {
  return {
    playerId: 99,
    playerAlias: alias,
    matchId,
    puuid: testPuuid(`global-untracked-${alias}`),
    queue: "solo",
    win,
    surrendered: false,
    kills: 1,
    deaths: 9,
    assists: 1,
    gameCreationAt: now,
  };
}

beforeEach(async () => {
  await resetTestLake(lakeDir);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("global scope", () => {
  test("an account tracked by two servers is counted once, not twice", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      // The exact shape that fans out: one PUUID, two accounts rows.
      alsoTrackedBy: [otherServerId],
      matchFacts: [
        trackedMatch("NA1_1", true),
        trackedMatch("NA1_2", false),
        trackedMatch("NA1_3", true),
      ],
    });

    const global = await executeReportQuery({
      prisma,
      scope: GLOBAL_SCOPE,
      queryText: "SELECT player, games FROM match_participants GROUP BY player",
      now,
    });

    const games = global.rows[0]?.values.find(
      (value) => value.column === "games",
    )?.value;
    expect(games).toBe(3);
    expect(global.rows).toHaveLength(1);

    // Guild scope sees the same three games through its own accounts row.
    const guild = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText: "SELECT player, games FROM match_participants GROUP BY player",
      now,
    });
    expect(
      guild.rows[0]?.values.find((value) => value.column === "games")?.value,
    ).toBe(3);
  });

  test("global includes participants no server tracks; guild scope excludes them", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [trackedMatch("NA1_1", true)],
      untrackedMatchFacts: [
        untrackedMatch("NA1_1", "Opponent One", false),
        untrackedMatch("NA1_1", "Opponent Two", false),
      ],
    });

    const global = await executeReportQuery({
      prisma,
      scope: GLOBAL_SCOPE,
      queryText: "SELECT player, games FROM match_participants GROUP BY player",
      now,
    });
    expect(global.rows).toHaveLength(3);

    const guild = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText: "SELECT player, games FROM match_participants GROUP BY player",
      now,
    });
    expect(guild.rows).toHaveLength(1);
  });

  test("global labels rows with the Riot ID and resolves no Discord mention", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        { ...trackedMatch("NA1_1", true), discordId: testAccountId("77") },
      ],
    });

    const global = await executeReportQuery({
      prisma,
      scope: GLOBAL_SCOPE,
      queryText: "SELECT player, games FROM match_participants GROUP BY player",
      now,
    });

    // riot_id_game_name#riot_id_tagline off the match fact — never the
    // server's player alias, which has no meaning outside that server.
    expect(global.rows[0]?.label).toBe("Tracked Player#NA1");
    expect(global.rows[0]?.mentionIdentity).toBeNull();

    // Guild scope still resolves the alias and the mention identity.
    const guild = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText: "SELECT player, games FROM match_participants GROUP BY player",
      now,
    });
    expect(guild.rows[0]?.label).toBe("Tracked Player");
    expect(guild.rows[0]?.mentionIdentity).not.toBeNull();
  });

  test("champion aggregates span every participant, not just tracked ones", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        {
          ...trackedMatch("NA1_1", true),
          championName: "Jinx",
          championId: 222,
        },
      ],
      untrackedMatchFacts: [
        {
          ...untrackedMatch("NA1_1", "Opponent One", false),
          championName: "Jinx",
          championId: 222,
        },
      ],
    });

    const global = await executeReportQuery({
      prisma,
      scope: GLOBAL_SCOPE,
      queryText:
        "SELECT champion, games FROM match_participants GROUP BY champion",
      now,
    });
    expect(global.rows).toHaveLength(1);
    expect(global.rows[0]?.label).toBe("Jinx");
    expect(
      global.rows[0]?.values.find((value) => value.column === "games")?.value,
    ).toBe(2);
  });

  test("player_groups is refused in global scope rather than answered wrongly", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [trackedMatch("NA1_1", true)],
    });

    await expect(
      executeReportQuery({
        prisma,
        scope: GLOBAL_SCOPE,
        queryText: "SELECT group, games FROM player_groups GROUP BY group(2)",
        now,
      }),
    ).rejects.toThrow(/not available in global scope/);
  });

  /**
   * Global scope computes `player_alias` as a SELECT-list expression
   * (`concat_ws('#', riot_id_game_name, riot_id_tagline)`) and then filters on
   * that name in the WHERE of the same query block. Standard SQL forbids that
   * — WHERE is evaluated before the SELECT list — but DuckDB accepts column
   * aliases in WHERE as a deliberate extension, which is what makes the
   * single-block form legal here.
   *
   * This is pinned because the shape reads like a bug to anyone applying
   * ordinary SQL rules (a reviewer flagged exactly that), and because it
   * silently depends on the engine staying DuckDB. If this ever fails, the
   * fix is to wrap the base select in a subquery and filter outside it — not
   * to drop the filter.
   */
  test("a global-scope player filter resolves the derived alias", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        untrackedMatch("NA1_1", "Faker", true),
        untrackedMatch("NA1_2", "Faker", false),
        untrackedMatch("NA1_3", "Nobody", true),
      ],
    });

    const result = await executeReportQuery({
      prisma,
      scope: GLOBAL_SCOPE,
      queryText:
        "SELECT player, games FROM match_participants WHERE player IN ('Faker#NA1') GROUP BY player DURING LAST 30 DAYS",
      now,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.label).toBe("Faker#NA1");
    expect(
      result.rows[0]?.values.find((value) => value.column === "games")?.value,
    ).toBe(2);
  });

  test("competition sources are refused in global scope", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [trackedMatch("NA1_1", true)],
    });

    await expect(
      executeReportQuery({
        prisma,
        scope: GLOBAL_SCOPE,
        queryText:
          "SELECT player, games FROM competition_match_participants WHERE competition_id = 1 GROUP BY player DURING LAST 30 DAYS",
        now,
      }),
    ).rejects.toThrow(/not available in global scope/);
  });
});
