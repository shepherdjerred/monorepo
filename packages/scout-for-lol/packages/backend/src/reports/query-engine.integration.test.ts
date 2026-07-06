import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { type Rank } from "@scout-for-lol/data";
import { createCompetition } from "#src/database/competition/queries.ts";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";

const { prisma } = createTestDatabase("report-query-engine-test");
const serverId = testGuildId("919191");
const now = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
const lakeDir = resolveLakeDir();

beforeEach(async () => {
  await cleanup();
  await resetTestLake(lakeDir);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("executeReportQuery", () => {
  test("runs a SQL-ish leaderboard query from the report lake", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        {
          playerId: 1,
          playerAlias: "First Player",
          matchId: "NA1_1",
          puuid: testPuuid("report-query-1"),
          queue: "solo",
          win: false,
          surrendered: true,
          kills: 2,
          deaths: 6,
          assists: 8,
          gameCreationAt: now,
        },
        {
          playerId: 1,
          playerAlias: "First Player",
          matchId: "NA1_2",
          puuid: testPuuid("report-query-1"),
          queue: "solo",
          win: true,
          surrendered: true,
          kills: 4,
          deaths: 2,
          assists: 9,
          gameCreationAt: now,
        },
        {
          playerId: 2,
          playerAlias: "Second Player",
          matchId: "NA1_3",
          puuid: testPuuid("report-query-2"),
          queue: "solo",
          win: true,
          surrendered: false,
          kills: 8,
          deaths: 1,
          assists: 3,
          gameCreationAt: now,
        },
      ],
    });

    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText: `
        SELECT player, games, surrenders, surrender_rate
        FROM match_participants
        WHERE queue IN ('solo')
        GROUP BY player
        ORDER BY surrender_rate DESC
        LIMIT 10
      `,
      lookbackDays: 30,
      maxRows: 10,
      now,
    });

    expect(result.rowsScanned).toBe(3);
    expect(result.columns).toEqual([
      "label",
      "games",
      "surrenders",
      "surrender_rate",
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.label).toBe("First Player");
    expect(result.rows[0]?.values).toEqual([
      { column: "games", value: 2 },
      { column: "surrenders", value: 2 },
      { column: "surrender_rate", value: 1 },
    ]);
  });

  test("caps query limit to requested max rows", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        {
          playerId: 1,
          playerAlias: "First Player",
          matchId: "NA1_4",
          puuid: testPuuid("report-query-3"),
          queue: "arena",
          win: true,
          surrendered: false,
          kills: 10,
          deaths: 0,
          assists: 5,
          gameCreationAt: now,
        },
        {
          playerId: 2,
          playerAlias: "Second Player",
          matchId: "NA1_5",
          puuid: testPuuid("report-query-4"),
          queue: "arena",
          win: true,
          surrendered: false,
          kills: 8,
          deaths: 0,
          assists: 5,
          gameCreationAt: now,
        },
      ],
    });

    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText:
        "SELECT player, games, kills FROM match_participants GROUP BY player ORDER BY kills DESC LIMIT 50",
      lookbackDays: 30,
      maxRows: 1,
      now,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.label).toBe("First Player");
  });

  test("runs player pair reports from the report lake", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        {
          playerId: 1,
          playerAlias: "First Player",
          matchId: "NA1_pair_1",
          puuid: testPuuid("report-pair-1"),
          queue: "solo",
          win: true,
          surrendered: false,
          kills: 2,
          deaths: 1,
          assists: 10,
          teamId: 100,
          gameCreationAt: now,
        },
        {
          playerId: 2,
          playerAlias: "Second Player",
          matchId: "NA1_pair_1",
          puuid: testPuuid("report-pair-2"),
          queue: "solo",
          win: true,
          surrendered: false,
          kills: 4,
          deaths: 2,
          assists: 6,
          teamId: 100,
          gameCreationAt: now,
        },
      ],
    });

    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText:
        "SELECT pair, games, wins, win_rate FROM player_pairs WHERE queue IN ('solo') GROUP BY pair ORDER BY win_rate DESC LIMIT 10",
      lookbackDays: 30,
      maxRows: 10,
      now,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.label).toBe("First Player + Second Player");
    expect(result.rows[0]?.values).toEqual([
      { column: "games", value: 1 },
      { column: "wins", value: 1 },
      { column: "win_rate", value: 1 },
    ]);
  });

  test("runs prematch reports from the report lake", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      prematchFacts: [
        {
          playerId: 1,
          playerAlias: "First Player",
          dedupeKey: "NA1:123",
          puuid: testPuuid("report-prematch-1"),
          queue: "solo",
          observedAt: now,
        },
      ],
    });

    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText:
        "SELECT player, prematches FROM prematch_participants WHERE queue IN ('solo') GROUP BY player ORDER BY prematches DESC",
      lookbackDays: 30,
      maxRows: 10,
      now,
    });

    expect(result.rows[0]?.values).toEqual([
      { column: "prematches", value: 1 },
    ]);
  });
});

describe("executeReportQuery competition rank reports", () => {
  test("formats highest-rank competition report scores as ranks", async () => {
    const player = await prisma.player.create({
      data: {
        discordId: testAccountId("919191001"),
        alias: "Ranked Player",
        serverId,
        creatorDiscordId: testAccountId("919191001"),
        createdTime: now,
        updatedTime: now,
        accounts: {
          create: [
            {
              puuid: testPuuid("report-rank-player"),
              alias: "Ranked Player",
              region: "AMERICA_NORTH",
              serverId,
              creatorDiscordId: testAccountId("919191001"),
              createdTime: now,
              updatedTime: now,
            },
          ],
        },
      },
    });
    const competition = await createCompetition(prisma, {
      serverId,
      ownerId: testAccountId("919191002"),
      channelId: testChannelId("919191003"),
      title: "Highest Rank Report",
      description: "Rank display regression",
      visibility: "OPEN",
      maxParticipants: 10,
      dates: {
        type: "FIXED_DATES",
        startDate: new Date("2026-05-01T00:00:00Z"),
        endDate: new Date("2026-05-31T23:59:59Z"),
      },
      criteria: {
        type: "HIGHEST_RANK",
        queue: "SOLO",
      },
    });
    await prisma.competitionParticipant.create({
      data: {
        competitionId: competition.id,
        playerId: player.id,
        status: "JOINED",
        joinedAt: new Date("2026-05-01T00:00:00Z"),
      },
    });

    const rank: Rank = {
      tier: "gold",
      division: 2,
      lp: 75,
      wins: 20,
      losses: 15,
    };
    await prisma.competitionSnapshot.create({
      data: {
        competitionId: competition.id,
        playerId: player.id,
        snapshotType: "END",
        snapshotData: JSON.stringify({ solo: rank }),
        snapshotTime: new Date("2026-05-31T23:59:59Z"),
      },
    });

    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText: `SELECT player, score FROM competition_rank WHERE competition_id = ${competition.id.toString()} GROUP BY player ORDER BY score DESC`,
      lookbackDays: 30,
      maxRows: 10,
      sourceCompetitionId: competition.id,
      now: new Date("2026-06-01T00:00:00Z"),
    });

    expect(result.columns).toEqual(["label", "rank"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.label).toBe("Ranked Player");
    expect(result.rows[0]?.values).toEqual([
      { column: "rank", value: "Gold II, 75LP" },
    ]);
  });
});

async function cleanup(): Promise<void> {
  await deleteIfExists(() => prisma.competitionSnapshot.deleteMany());
  await deleteIfExists(() => prisma.competitionParticipant.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
  await deleteIfExists(() => prisma.prematchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.storedPrematch.deleteMany());
  await deleteIfExists(() => prisma.matchParticipantFact.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
}
