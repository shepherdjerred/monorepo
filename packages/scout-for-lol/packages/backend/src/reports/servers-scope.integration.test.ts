import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testGuildId, testPuuid } from "#src/testing/test-ids.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import {
  resetTestLake,
  writeTestLake,
  type TestLakeMatchFact,
} from "#src/testing/test-report-lake.ts";
import { executeReportQuery } from "#src/reports/query/query-engine.ts";
import {
  guildScope,
  serversScope,
  type LakeQueryScope,
} from "#src/reports/duckdb/scope.ts";

/**
 * The `servers` scope: the tracked players of several servers at once.
 *
 * Each server keeps its own player row, so the same person tracked by two
 * servers has two player ids, and the accounts dimension has one row per
 * (server, account). Both would double-count if joined naively. These cases
 * pin that a person counts once, keeps one label, and that the scope refuses
 * the sources it cannot narrow.
 *
 * Player ids differ per server on purpose, as they do in production; the
 * fixture would otherwise reuse one id across servers and hide a split.
 */

const { prisma } = createTestDatabase("report-servers-scope-test");
const ALPHA = testGuildId("515151");
const BETA = testGuildId("525252");
const now = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
const lakeDir = resolveLakeDir();
const BOUND = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";

function game(input: {
  matchId: string;
  playerId: number;
  alias: string;
  puuid: string;
  servers: string[];
  discordId?: string;
  teamId?: number;
}): TestLakeMatchFact {
  return {
    playerId: input.playerId,
    playerAlias: input.alias,
    accountServerIds: input.servers,
    discordId: input.discordId ?? null,
    matchId: input.matchId,
    puuid: input.puuid,
    queue: "solo",
    win: true,
    surrendered: false,
    kills: 1,
    deaths: 1,
    assists: 1,
    teamId: input.teamId ?? 100,
    gameCreationAt: now,
  };
}

async function gamesByPlayer(
  scope: LakeQueryScope,
): Promise<Map<string, unknown>> {
  const result = await executeReportQuery({
    prisma,
    scope,
    queryText: `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} GROUP BY player`,
    now,
  });
  return new Map(
    result.rows.map((row) => [
      row.label,
      row.values.find((value) => value.column === "games")?.value,
    ]),
  );
}

beforeEach(async () => {
  await resetTestLake(lakeDir);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("servers scope", () => {
  test("one server is guild scope, not a one-element list", () => {
    expect(serversScope([ALPHA, ALPHA])).toEqual(guildScope(ALPHA));
    expect(serversScope([ALPHA, BETA]).kind).toBe("servers");
  });

  test("a player both servers track counts once, under one label", async () => {
    const mira = testPuuid("servers-mira");
    await writeTestLake(lakeDir, {
      serverId: ALPHA,
      matchFacts: [
        // Alpha knows her as player 11 and Beta as player 72; the same account.
        game({
          matchId: "NA1_1",
          playerId: 11,
          alias: "Mira",
          puuid: mira,
          servers: [ALPHA],
        }),
        game({
          matchId: "NA1_2",
          playerId: 72,
          alias: "Mira B",
          puuid: mira,
          servers: [BETA],
        }),
      ],
    });

    // Two games, not four: each server's account row matches both.
    expect(await gamesByPlayer(serversScope([ALPHA, BETA]))).toEqual(
      new Map([["Mira", 2]]),
    );
  });

  test("accounts linked by a Discord id across servers are one person", async () => {
    await writeTestLake(lakeDir, {
      serverId: ALPHA,
      matchFacts: [
        game({
          matchId: "NA1_1",
          playerId: 21,
          alias: "Otto",
          puuid: testPuuid("servers-otto-main"),
          servers: [ALPHA],
          discordId: "900000000000000021",
        }),
        game({
          matchId: "NA1_2",
          playerId: 83,
          alias: "Otto Smurf",
          puuid: testPuuid("servers-otto-smurf"),
          servers: [BETA],
          discordId: "900000000000000021",
        }),
      ],
    });

    expect(await gamesByPlayer(serversScope([ALPHA, BETA]))).toEqual(
      new Map([["Otto", 2]]),
    );
  });

  test("people nothing links stay separate", async () => {
    await writeTestLake(lakeDir, {
      serverId: ALPHA,
      matchFacts: [
        game({
          matchId: "NA1_1",
          playerId: 31,
          alias: "Ana",
          puuid: testPuuid("servers-ana"),
          servers: [ALPHA],
        }),
        game({
          matchId: "NA1_2",
          playerId: 94,
          alias: "Bo",
          puuid: testPuuid("servers-bo"),
          servers: [BETA],
        }),
      ],
    });

    expect(await gamesByPlayer(serversScope([ALPHA, BETA]))).toEqual(
      new Map([
        ["Ana", 1],
        ["Bo", 1],
      ]),
    );
  });

  test("a one-server list answers exactly as that server's guild scope", async () => {
    await writeTestLake(lakeDir, {
      serverId: ALPHA,
      matchFacts: [
        game({
          matchId: "NA1_1",
          playerId: 41,
          alias: "Cy",
          puuid: testPuuid("servers-cy"),
          servers: [ALPHA],
        }),
        game({
          matchId: "NA1_2",
          playerId: 41,
          alias: "Cy",
          puuid: testPuuid("servers-cy"),
          servers: [ALPHA],
        }),
      ],
    });

    expect(
      await gamesByPlayer({ kind: "servers", serverIds: [ALPHA] }),
    ).toEqual(await gamesByPlayer(guildScope(ALPHA)));
  });

  test("teammates tracked by different servers form a group", async () => {
    await writeTestLake(lakeDir, {
      serverId: ALPHA,
      matchFacts: [
        game({
          matchId: "NA1_1",
          playerId: 51,
          alias: "Dee",
          puuid: testPuuid("servers-dee"),
          servers: [ALPHA],
        }),
        game({
          matchId: "NA1_1",
          playerId: 105,
          alias: "Eli",
          puuid: testPuuid("servers-eli"),
          servers: [BETA],
        }),
      ],
    });

    const result = await executeReportQuery({
      prisma,
      scope: serversScope([ALPHA, BETA]),
      queryText: `SELECT COUNT(*) AS games FROM player_groups WHERE ${BOUND} GROUP BY group(2)`,
      now,
    });
    expect(result.rows).toHaveLength(1);
    expect(
      result.rows[0]?.values.find((value) => value.column === "games")?.value,
    ).toBe(1);
  });

  test("a player both servers track is never grouped with themself", async () => {
    const fay = testPuuid("servers-fay");
    await writeTestLake(lakeDir, {
      serverId: ALPHA,
      matchFacts: [
        game({
          matchId: "NA1_1",
          playerId: 61,
          alias: "Fay",
          puuid: fay,
          servers: [ALPHA, BETA],
        }),
      ],
    });

    const result = await executeReportQuery({
      prisma,
      scope: serversScope([ALPHA, BETA]),
      queryText: `SELECT COUNT(*) AS games FROM player_groups WHERE ${BOUND} GROUP BY group(2)`,
      now,
    });
    expect(result.rows).toHaveLength(0);
  });

  test("team sources and competition sources are refused", async () => {
    await writeTestLake(lakeDir, {
      serverId: ALPHA,
      matchFacts: [
        game({
          matchId: "NA1_1",
          playerId: 71,
          alias: "Gus",
          puuid: testPuuid("servers-gus"),
          servers: [ALPHA],
        }),
      ],
    });
    const scope = serversScope([ALPHA, BETA]);

    await expect(
      executeReportQuery({
        prisma,
        scope,
        queryText: `SELECT COUNT(*) AS teams FROM match_teams WHERE ${BOUND}`,
        now,
      }),
    ).rejects.toThrow(/cannot be scoped to a server/);
    await expect(
      executeReportQuery({
        prisma,
        scope,
        queryText: `SELECT COUNT(*) AS games FROM competition_match_participants WHERE competition_id = 1 GROUP BY player`,
        now,
      }),
    ).rejects.toThrow(/one server/);
  });
});
