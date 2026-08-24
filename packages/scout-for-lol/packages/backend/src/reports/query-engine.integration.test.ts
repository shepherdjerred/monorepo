import { afterAll, beforeEach, describe, expect, test } from "vitest";
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
import {
  executeReportQuery,
  type ReportResultRow,
} from "#src/reports/query-engine.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";

const { prisma } = createTestDatabase("report-query-engine-test");
const serverId = testGuildId("919191");
const now = new Date(Date.UTC(2026, 4, 17, 12, 0, 0));
const lakeDir = resolveLakeDir();
const BOUND = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";

/** The plain (column, value) pairs, without the evidence a row also carries. */
function valuesOf(row: ReportResultRow | undefined) {
  return (row?.values ?? []).map((value) => ({
    column: value.column,
    value: value.value,
  }));
}

function temporalMatch(matchId: string, date: string, win: boolean) {
  return {
    playerId: 1,
    playerAlias: "Temporal Player",
    matchId,
    puuid: testPuuid(`temporal-${matchId}`),
    queue: "solo",
    win,
    surrendered: false,
    kills: win ? 4 : 1,
    deaths: win ? 1 : 4,
    assists: 5,
    gameCreationAt: new Date(date),
  };
}

beforeEach(async () => {
  await cleanup();
  await resetTestLake(lakeDir);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("executeReportQuery", () => {
  test("runs a leaderboard query from the report lake", async () => {
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
      scope: guildScope(serverId),
      queryText: `
        SELECT COUNT(*) AS games,
               COUNT(*) FILTER (WHERE surrendered) AS surrenders,
               AVG(surrendered::INT) AS surrender_rate
        FROM match_participants
        WHERE queue IN ('solo') AND ${BOUND}
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
    expect(valuesOf(result.rows[0])).toEqual([
      { column: "games", value: 2 },
      { column: "surrenders", value: 2 },
      { column: "surrender_rate", value: 1 },
    ]);
    // A rate output earns a Wilson interval from its own successes/trials.
    expect(
      result.rows[0]?.values.find((value) => value.column === "surrender_rate"),
    ).toMatchObject({ sampleSize: 2, successes: 2 });
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
      scope: guildScope(serverId),
      queryText: `SELECT SUM(kills) AS kills FROM match_participants WHERE ${BOUND} GROUP BY player ORDER BY kills DESC LIMIT 1`,
      now,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.label).toBe("First Player");
  });

  test("computes percentiles and spread in SQL", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [2, 3, 7, 12, 20].map((kills, index) => ({
        playerId: 1,
        playerAlias: "First Player",
        matchId: `NA1_dist_${index.toString()}`,
        puuid: testPuuid("report-dist"),
        queue: "solo",
        win: true,
        surrendered: false,
        kills,
        deaths: 1,
        assists: 1,
        gameCreationAt: now,
      })),
    });

    const result = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText:
        "SELECT MEDIAN(kills) AS med, QUANTILE_CONT(kills, 0.9) AS p90, " +
        "COUNT(DISTINCT kills) AS distinct_kills FROM match_participants " +
        `WHERE ${BOUND} GROUP BY player`,
      now,
    });

    expect(valuesOf(result.rows[0])).toEqual([
      { column: "med", value: 7 },
      { column: "p90", value: 16.8 },
      { column: "distinct_kills", value: 5 },
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
      scope: guildScope(serverId),
      queryText:
        "SELECT COUNT(*) AS prematches FROM prematch_participants " +
        "WHERE queue IN ('solo') AND observed_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
        "GROUP BY player ORDER BY prematches DESC",
      now,
    });

    expect(valuesOf(result.rows[0])).toEqual([
      { column: "prematches", value: 1 },
    ]);
  });

  test("an unbounded query covers all ingested history", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        temporalMatch("NA1_ancient", "2019-01-01T12:00:00.000Z", true),
        temporalMatch("NA1_recent", "2026-05-16T12:00:00.000Z", true),
      ],
    });

    const result = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText:
        "SELECT COUNT(*) AS games FROM match_participants GROUP BY player",
      now,
    });

    expect(valuesOf(result.rows[0])).toEqual([{ column: "games", value: 2 }]);
  });
});

describe("executeReportQuery temporal buckets", () => {
  test("buckets prematch observations by day", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      prematchFacts: [
        {
          playerId: 1,
          playerAlias: "First Player",
          dedupeKey: "NA1:temporal-prematch",
          puuid: testPuuid("report-temporal-prematch"),
          queue: "solo",
          observedAt: now,
        },
      ],
    });

    const result = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText:
        "SELECT DATE_TRUNC('day', observed_at) AS day, COUNT(*) AS prematches " +
        "FROM prematch_participants " +
        "WHERE observed_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
        "GROUP BY DATE_TRUNC('day', observed_at) ORDER BY day ASC",
      now,
    });

    expect(result.rows).toHaveLength(1);
    expect(
      result.rows[0]?.values.find((value) => value.column === "prematches")
        ?.value,
    ).toBe(1);
    expect(result.visualization?.bucket).toBe("day");
  });

  test("rolls a ratio output using its own numerator and denominator", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        {
          ...temporalMatch("NA1_ratio_1", "2026-05-16T12:00:00.000Z", true),
          kills: 10,
          deaths: 1,
        },
        {
          ...temporalMatch("NA1_ratio_2", "2026-05-17T12:00:00.000Z", false),
          kills: 10,
          deaths: 10,
        },
      ],
    });

    const result = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText:
        "SELECT DATE_TRUNC('day', game_creation_at) AS day, " +
        "SUM(kills) / NULLIF(SUM(deaths), 0) AS kd FROM match_participants " +
        "WHERE game_creation_at::DATE BETWEEN '2026-05-16' AND '2026-05-17' " +
        "GROUP BY DATE_TRUNC('day', game_creation_at) ORDER BY day ASC " +
        "RENDER line_chart WITH (y = kd, rolling = 2)",
      now,
    });

    expect(result.visualization?.series[0]?.points[0]?.value).toBeNull();
    expect(result.visualization?.series[0]?.points[1]).toMatchObject({
      value: 20 / 11,
      evidence: { numerator: 20, denominator: 11 },
    });
  });

  test("keeps signed evidence for a calculated ratio", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        temporalMatch("NA1_signed_ratio", "2026-05-16T12:00:00.000Z", false),
      ],
    });

    const result = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText:
        "SELECT DATE_TRUNC('day', game_creation_at) AS day, " +
        "(SUM(kills) - SUM(deaths)) / NULLIF(COUNT(*), 0) AS differential " +
        "FROM match_participants " +
        "WHERE game_creation_at::DATE BETWEEN '2026-05-16' AND '2026-05-16' " +
        "GROUP BY DATE_TRUNC('day', game_creation_at) ORDER BY day ASC " +
        "RENDER line_chart WITH (y = differential)",
      now,
    });

    expect(result.visualization?.series[0]?.points[0]).toMatchObject({
      value: -3,
      evidence: { numerator: -3, denominator: 1 },
    });
  });
});

describe("executeReportQuery compare = previous_period", () => {
  test("aligns the preceding period bucket by bucket and fills additive gaps", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        temporalMatch("NA1_baseline", "2026-05-15T12:00:00.000Z", true),
        temporalMatch("NA1_current_1", "2026-05-16T12:00:00.000Z", false),
        temporalMatch("NA1_current_2", "2026-05-17T12:00:00.000Z", true),
      ],
    });

    const result = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText:
        "SELECT DATE_TRUNC('day', game_creation_at) AS day, COUNT(*) AS games, " +
        "AVG(win::INT) AS win_rate FROM match_participants " +
        "WHERE game_creation_at::DATE BETWEEN '2026-05-16' AND '2026-05-17' " +
        "GROUP BY DATE_TRUNC('day', game_creation_at) ORDER BY day ASC " +
        "RENDER line_chart WITH (y = (games, win_rate), compare = previous_period)",
      now,
    });

    const byDay = new Map(result.rows.map((row) => [row.label, row]));
    // 2026-05-16 pairs with 2026-05-14, which has no games at all.
    expect(
      byDay.get("2026-05-16")?.values.find((v) => v.column === "games"),
    ).toMatchObject({
      value: 1,
      comparisonValue: 0,
      absoluteDelta: 1,
      percentageDelta: null,
      comparisonSampleSize: 0,
    });
    expect(
      byDay.get("2026-05-16")?.values.find((v) => v.column === "win_rate"),
    ).toMatchObject({ value: 0, comparisonValue: null });
    // 2026-05-17 pairs with 2026-05-15, which has one win.
    expect(
      byDay.get("2026-05-17")?.values.find((v) => v.column === "games"),
    ).toMatchObject({ value: 1, comparisonValue: 1 });
    expect(
      byDay.get("2026-05-17")?.values.find((v) => v.column === "win_rate"),
    ).toMatchObject({ value: 1, comparisonValue: 1, comparisonSuccesses: 1 });
    // Both periods were scanned.
    expect(result.rowsScanned).toBe(3);
    expect(result.visualization?.temporal?.comparison).toEqual({
      kind: "previous_period",
    });
  });

  // The analyzer refuses this at compile; the engine asserts it again, because
  // executing it would silently compare against an arbitrary range.
  test("refuses a comparison with no time axis to align on", async () => {
    await expect(
      executeReportQuery({
        prisma,
        scope: guildScope(serverId),
        queryText:
          `SELECT COUNT(*) AS games FROM match_participants WHERE ${BOUND} ` +
          "GROUP BY player RENDER line_chart WITH (y = games, compare = previous_period)",
        now,
      }),
    ).rejects.toThrow(/previous_period/u);
  });
});

describe("executeReportQuery distribution renders", () => {
  test("HISTOGRAM buckets game length into one ascending series", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [400, 500, 700, 1300].map((duration, index) => ({
        playerId: 1,
        playerAlias: "First Player",
        matchId: `NA1_hist_${index.toString()}`,
        puuid: testPuuid("report-hist"),
        queue: "solo",
        win: true,
        surrendered: false,
        kills: 1,
        deaths: 1,
        assists: 1,
        gameDurationSeconds: duration,
        timePlayedSeconds: duration,
        gameCreationAt: now,
      })),
    });

    const result = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText:
        "SELECT FLOOR(game_duration_seconds / 300) * 300 AS bucket, COUNT(*) AS games " +
        `FROM match_participants WHERE ${BOUND} ` +
        "GROUP BY FLOOR(game_duration_seconds / 300) * 300 RENDER histogram",
      now,
    });

    expect(result.visualization?.series).toHaveLength(1);
    expect(
      result.visualization?.series[0]?.points.map((point) => [
        point.label,
        point.value,
      ]),
    ).toEqual([
      ["300–599", 2],
      ["600–899", 1],
      ["1200–1499", 1],
    ]);
  });

  test("BOX_PLOT emits five series in encoding order", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [0, 2, 4, 7, 12].map((kills, index) => ({
        playerId: 1,
        playerAlias: "First Player",
        matchId: `NA1_box_${index.toString()}`,
        puuid: testPuuid("report-box"),
        queue: "solo",
        win: true,
        surrendered: false,
        kills,
        deaths: 1,
        assists: 1,
        championName: "Ahri",
        championId: 103,
        gameCreationAt: now,
      })),
    });

    const result = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText:
        "SELECT MIN(kills) AS low, QUANTILE_CONT(kills, 0.25) AS q1, " +
        "MEDIAN(kills) AS med, QUANTILE_CONT(kills, 0.75) AS q3, MAX(kills) AS high " +
        `FROM match_participants WHERE ${BOUND} GROUP BY champion ` +
        "RENDER box_plot WITH (y = (low, q1, med, q3, high))",
      now,
    });

    expect(result.visualization?.series.map((series) => series.metric)).toEqual(
      ["low", "q1", "med", "q3", "high"],
    );
    expect(
      result.visualization?.series.map((series) => series.points[0]?.value),
    ).toEqual([0, 2, 4, 7, 12]);
    expect(
      result.visualization?.series.every(
        (series) => series.points[0]?.key === "Ahri",
      ),
    ).toBe(true);
  });
});

describe("executeReportQuery player groups", () => {
  test("group(2) folds a duo's counters and carries the game's outcome", async () => {
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
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
      ],
    });

    const result = await executeReportQuery({
      prisma,
      scope: guildScope(serverId),
      queryText:
        "SELECT COUNT(*) AS games, COUNT(*) FILTER (WHERE win) AS wins, " +
        "SUM(kills) AS kills, AVG(win::INT) AS win_rate FROM player_groups " +
        `WHERE ${BOUND} GROUP BY group(2)`,
      now,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.label).toBe("First Player + Second Player");
    expect(valuesOf(result.rows[0])).toEqual([
      { column: "games", value: 1 },
      { column: "wins", value: 1 },
      { column: "kills", value: 6 },
      { column: "win_rate", value: 1 },
    ]);
    expect(result.rows[0]?.mentionIdentity).toEqual({
      kind: "group",
      members: [
        { playerId: 1, alias: "First Player" },
        { playerId: 2, alias: "Second Player" },
      ],
    });
  });

  test("group(all) on a trio yields pairs and the trio", async () => {
    const trio = [1, 2, 3].map((playerId) => ({
      playerId,
      playerAlias: `Player ${playerId.toString()}`,
      matchId: "NA1_group_trio",
      puuid: testPuuid(`report-trio-${playerId.toString()}`),
      queue: "solo",
      win: true,
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
      scope: guildScope(serverId),
      queryText:
        "SELECT COUNT(*) AS games, SUM(kills) AS kills FROM player_groups " +
        `WHERE ${BOUND} GROUP BY group(all)`,
      now,
    });

    expect(result.rows.map((row) => row.label)).toEqual([
      "Player 1 + Player 2",
      "Player 1 + Player 2 + Player 3",
      "Player 1 + Player 3",
      "Player 2 + Player 3",
    ]);
    const killsByLabel = new Map(
      result.rows.map((row) => [
        row.label,
        row.values.find((value) => value.column === "kills")?.value,
      ]),
    );
    expect(killsByLabel.get("Player 1 + Player 2")).toBe(3);
    expect(killsByLabel.get("Player 1 + Player 2 + Player 3")).toBe(6);
  });

  test("Arena groups scope to the subteam, never the whole team side", async () => {
    // Two duos share team side 100 in one Arena match — subteam scoping must
    // keep the duos apart rather than reporting a four-stack.
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
      scope: guildScope(serverId),
      queryText:
        "SELECT COUNT(*) AS games, COUNT(*) FILTER (WHERE win) AS wins " +
        `FROM player_groups WHERE queue IN ('arena') AND ${BOUND} ` +
        "GROUP BY group(all)",
      now,
    });

    expect(result.rows.map((row) => row.label)).toEqual([
      "Arena 1 + Arena 2",
      "Arena 3 + Arena 4",
    ]);
    const winsByLabel = new Map(
      result.rows.map((row) => [
        row.label,
        row.values.find((value) => value.column === "wins")?.value,
      ]),
    );
    expect(winsByLabel.get("Arena 1 + Arena 2")).toBe(1);
    expect(winsByLabel.get("Arena 3 + Arena 4")).toBe(0);
  });
});

describe("executeReportQuery competition rank reports", () => {
  test("renders a highest-rank competition score as a rank name", async () => {
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
      scope: guildScope(serverId),
      queryText: `SELECT MAX(score) AS score FROM competition_rank WHERE competition_id = ${competition.id.toString()} GROUP BY player ORDER BY score DESC`,
      sourceCompetitionId: competition.id,
      now: new Date("2026-06-01T00:00:00Z"),
    });

    expect(result.columns).toEqual(["label", "score"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.label).toBe("Ranked Player");
    expect(valuesOf(result.rows[0])).toEqual([
      { column: "score", value: "Gold II, 75LP" },
    ]);
  });
});

async function cleanup(): Promise<void> {
  await deleteIfExists(() => prisma.competitionSnapshot.deleteMany());
  await deleteIfExists(() => prisma.competitionParticipant.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
}
