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

  test("uses the row limit declared in ScoutQL", async () => {
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
        "SELECT player, games, kills FROM match_participants GROUP BY player ORDER BY kills DESC LIMIT 1",
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
      now,
    });

    expect(result.rows[0]?.values).toEqual([
      { column: "prematches", value: 1 },
    ]);
  });
});

describe("executeReportQuery player groups", () => {
  test("group(2) matches the legacy pair query on the same lake", async () => {
    const matchFacts = [
      {
        playerId: 1,
        playerAlias: "First Player",
        matchId: "NA1_group_eq",
        puuid: testPuuid("report-group-1"),
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
        matchId: "NA1_group_eq",
        puuid: testPuuid("report-group-2"),
        queue: "solo",
        win: true,
        surrendered: false,
        kills: 4,
        deaths: 2,
        assists: 6,
        teamId: 100,
        gameCreationAt: now,
      },
    ];
    await writeTestLake(lakeDir, { serverId, matchFacts });

    const base = {
      prisma,
      serverId,
      now,
    };
    const legacy = await executeReportQuery({
      ...base,
      queryText:
        "SELECT pair, games, wins, kills, win_rate FROM player_pairs GROUP BY pair",
    });
    const modern = await executeReportQuery({
      ...base,
      queryText:
        "SELECT group, games, wins, kills, win_rate FROM player_groups GROUP BY group(2)",
    });
    expect(modern.rows).toEqual(legacy.rows);
    expect(modern.rows[0]?.label).toBe("First Player + Second Player");
    expect(
      modern.rows[0]?.values.find((value) => value.column === "kills")?.value,
    ).toBe(6);
  });

  test("group(all) on a trio yields pairs and the trio, all-win semantics", async () => {
    const trio = [1, 2, 3].map((playerId) => ({
      playerId,
      playerAlias: `Player ${playerId.toString()}`,
      matchId: "NA1_group_trio",
      puuid: testPuuid(`report-trio-${playerId.toString()}`),
      queue: "solo",
      win: playerId !== 3, // one loser breaks every group containing them
      surrendered: false,
      kills: playerId,
      deaths: 1,
      assists: 1,
      teamId: 100,
      gameCreationAt: now,
    }));
    await writeTestLake(lakeDir, { serverId, matchFacts: trio });

    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText:
        "SELECT group, games, wins FROM player_groups GROUP BY group(all) ORDER BY label ASC",
      now,
    });

    expect(result.rows.map((row) => row.label)).toEqual([
      "Player 1 + Player 2",
      "Player 1 + Player 2 + Player 3",
      "Player 1 + Player 3",
      "Player 2 + Player 3",
    ]);
    const winsByLabel = new Map(
      result.rows.map((row) => [
        row.label,
        row.values.find((value) => value.column === "wins")?.value,
      ]),
    );
    expect(winsByLabel.get("Player 1 + Player 2")).toBe(1);
    expect(winsByLabel.get("Player 1 + Player 3")).toBe(0);
    expect(winsByLabel.get("Player 1 + Player 2 + Player 3")).toBe(0);
  });

  test("Arena groups scope to the subteam, never the whole team side", async () => {
    // Two duos share team side 100 in one Arena match — the old pair engine
    // wrongly joined all four; subteam scoping must keep the duos apart.
    const arenaFacts = [
      { playerId: 1, subteam: 1 },
      { playerId: 2, subteam: 1 },
      { playerId: 3, subteam: 2 },
      { playerId: 4, subteam: 2 },
    ].map(({ playerId, subteam }) => ({
      playerId,
      playerAlias: `Arena ${playerId.toString()}`,
      matchId: "NA1_group_arena",
      puuid: testPuuid(`report-arena-${playerId.toString()}`),
      queue: "arena",
      win: subteam === 1,
      surrendered: false,
      kills: 3,
      deaths: 2,
      assists: 4,
      teamId: 100,
      playerSubteamId: subteam,
      gameCreationAt: now,
    }));
    await writeTestLake(lakeDir, { serverId, matchFacts: arenaFacts });

    const result = await executeReportQuery({
      prisma,
      serverId,
      queryText:
        "SELECT group, games, wins FROM player_groups WHERE queue IN ('arena') GROUP BY group(all) ORDER BY label ASC",
      now,
    });

    expect(result.rows.map((row) => row.label)).toEqual([
      "Arena 1 + Arena 2",
      "Arena 3 + Arena 4",
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
