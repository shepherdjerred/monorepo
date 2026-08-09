import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  ChampionIdSchema,
  type CachedLeaderboard,
  type CompetitionId,
  type CompetitionCriteria,
  type PlayerId,
} from "@scout-for-lol/data";
import { createCompetition } from "#src/database/competition/queries.ts";
import {
  analyzeCompetition,
  cachedCompetitionAnalysis,
  competitionCriterionQuery,
} from "#src/league/competition/analysis.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
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
import { resetTestLake, writeTestLake } from "#src/testing/test-report-lake.ts";

const { prisma } = createTestDatabase("competition-analysis-test");
const serverId = testGuildId("808080");
const now = new Date("2026-06-01T00:00:00.000Z");
const lakeDir = resolveLakeDir();
const targetChampionId = ChampionIdSchema.parse(99);

beforeEach(async () => {
  await cleanup();
  await resetTestLake(lakeDir);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("competition selected-period analysis", () => {
  test("recomputes every match criterion with date, participant, and queue bounds", async () => {
    const cases: {
      criteria: CompetitionCriteria;
      expectedScore: number;
    }[] = [
      {
        criteria: { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
        expectedScore: 2,
      },
      {
        criteria: { type: "MOST_WINS_PLAYER", queue: "SOLO" },
        expectedScore: 2,
      },
      {
        criteria: {
          type: "MOST_WINS_CHAMPION",
          championId: targetChampionId,
          queue: "SOLO",
        },
        expectedScore: 2,
      },
      {
        criteria: {
          type: "HIGHEST_WIN_RATE",
          minGames: 1,
          queue: "SOLO",
        },
        expectedScore: 1,
      },
    ];

    for (const item of cases) {
      await cleanup();
      await resetTestLake(lakeDir);
      const result = await runMatchAnalysis(item.criteria);
      expect(result.standings[0]?.playerName).toBe("Alpha");
      expect(result.standings[0]?.score).toBe(item.expectedScore);
      expect(result.rowsScanned).toBeGreaterThan(0);
    }
  });

  test("uses boundary leaderboard snapshots for highest rank and rank climb", async () => {
    const highest = await runRankAnalysis({
      type: "HIGHEST_RANK",
      queue: "SOLO",
    });
    expect(highest.standings[0]?.playerName).toBe("Alpha");
    expect(highest.standings[0]?.score).toBe(1400);
    expect(highest.visualization?.kind).toBe("BUMP_CHART");

    await cleanup();
    const climb = await runRankAnalysis({
      type: "MOST_RANK_CLIMB",
      queue: "SOLO",
    });
    expect(climb.standings[0]?.playerName).toBe("Alpha");
    expect(climb.standings[0]?.score).toBe(400);
  });
});

describe("competition preset date bounds", () => {
  test("uses match facts for non-rank presets in rank competitions", async () => {
    const { alpha, beta, competition } = await setupCompetition({
      type: "HIGHEST_RANK",
      queue: "SOLO",
    });
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact({
          playerId: alpha.id,
          playerAlias: "Alpha",
          matchId: "rank-before-competition",
          queue: "solo",
          win: true,
          championId: targetChampionId,
          date: "2026-04-30",
        }),
        fact({
          playerId: alpha.id,
          playerAlias: "Alpha",
          matchId: "rank-competition-match",
          queue: "solo",
          win: true,
          championId: targetChampionId,
          date: "2026-05-12",
        }),
        fact({
          playerId: alpha.id,
          playerAlias: "Alpha",
          matchId: "rank-after-competition",
          queue: "solo",
          win: true,
          championId: targetChampionId,
          date: "2026-06-01",
        }),
      ],
    });
    const history: CachedLeaderboard[] = [
      leaderboard(competition.id, "2026-05-09T00:00:00.000Z", [
        [alpha.id, "Alpha", 1000, 2],
        [beta.id, "Beta", 1200, 1],
      ]),
      leaderboard(competition.id, "2026-05-21T00:00:00.000Z", [
        [alpha.id, "Alpha", 1400, 1],
        [beta.id, "Beta", 1250, 2],
      ]),
    ];

    const result = await analyzeCompetition({
      prisma,
      competition,
      mode: "selected_period",
      preset: "games_wins",
      startDate: "2026-04-20",
      endDate: "2026-06-10",
      history,
      official: null,
      now,
    });

    expect(result.standings[0]?.playerName).toBe("Alpha");
    expect(result.standings[0]?.score).toBe(1400);
    expect(result.visualization?.kind).toBe("LINE_CHART");
    expect(result.visualization?.series.map((series) => series.metric)).toEqual(
      ["games", "wins"],
    );
    expect(
      result.visualization?.series
        .find((series) => series.metric === "games")
        ?.points.reduce((total, point) => total + (point.value ?? 0), 0),
    ).toBe(1);
    expect(result.visualization?.temporal?.window).toEqual({
      kind: "calendar",
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });
  });

  test("clamps match-criterion presets to competition dates", async () => {
    const { alpha, competition } = await setupCompetition({
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    });
    await writeTestLake(lakeDir, {
      serverId,
      matchFacts: [
        fact({
          playerId: alpha.id,
          playerAlias: "Alpha",
          matchId: "match-before-competition",
          queue: "solo",
          win: true,
          championId: targetChampionId,
          date: "2026-04-30",
        }),
        fact({
          playerId: alpha.id,
          playerAlias: "Alpha",
          matchId: "match-in-competition",
          queue: "solo",
          win: true,
          championId: targetChampionId,
          date: "2026-05-12",
        }),
        fact({
          playerId: alpha.id,
          playerAlias: "Alpha",
          matchId: "match-after-competition",
          queue: "solo",
          win: true,
          championId: targetChampionId,
          date: "2026-06-01",
        }),
      ],
    });

    const result = await analyzeCompetition({
      prisma,
      competition,
      mode: "selected_period",
      preset: "games_wins",
      startDate: "2026-04-20",
      endDate: "2026-06-10",
      history: [],
      official: null,
      now,
    });

    expect(result.standings[0]?.score).toBe(1);
    expect(
      result.visualization?.series
        .find((series) => series.metric === "games")
        ?.points.reduce((total, point) => total + (point.value ?? 0), 0),
    ).toBe(1);
    expect(result.visualization?.temporal?.window).toEqual({
      kind: "calendar",
      startDate: "2026-05-01",
      endDate: "2026-05-31",
    });
  });
});

describe("competition analysis behavior", () => {
  test("ignores selected dates in official mode", async () => {
    const { alpha, beta, competition } = await setupCompetition({
      type: "HIGHEST_RANK",
      queue: "SOLO",
    });
    const history: CachedLeaderboard[] = [
      leaderboard(competition.id, "2026-05-01T00:00:00.000Z", [
        [alpha.id, "Alpha", 1000, 2],
        [beta.id, "Beta", 1200, 1],
      ]),
      leaderboard(competition.id, "2026-05-31T00:00:00.000Z", [
        [alpha.id, "Alpha", 1400, 1],
        [beta.id, "Beta", 1250, 2],
      ]),
    ];
    const official: CachedLeaderboard = leaderboard(
      competition.id,
      "2026-05-31T00:00:00.000Z",
      [[alpha.id, "Alpha", 1400, 1]],
    );

    const criterion = await analyzeCompetition({
      prisma,
      competition,
      mode: "official",
      preset: "criterion_score",
      startDate: "1900-01-01",
      endDate: "1900-01-02",
      history,
      official,
      now,
    });
    expect(criterion.standings).toEqual(official.entries);

    const rankPosition = await analyzeCompetition({
      prisma,
      competition,
      mode: "official",
      preset: "rank_position",
      startDate: "1900-01-01",
      endDate: "1900-01-02",
      history,
      official,
      now,
    });
    expect(rankPosition.visualization?.kind).toBe("BUMP_CHART");
    expect(rankPosition.rowsScanned).toBe(4);
    expect(rankPosition.standings).toEqual(official.entries);
  });

  test("generates queue-aware ScoutQL for every match criterion", () => {
    expect(
      competitionCriterionQuery({
        type: "MOST_GAMES_PLAYED",
        queue: "RANKED_ANY",
      }),
    ).toContain("queue IN ('solo', 'flex')");
    expect(
      competitionCriterionQuery({
        type: "MOST_WINS_CHAMPION",
        championId: targetChampionId,
        queue: "ALL",
      }),
    ).toContain("WHERE champion_id = 99 GROUP BY");
    expect(
      competitionCriterionQuery({
        type: "MOST_GAMES_PLAYED",
        queue: "DRAFT_PICK",
      }),
    ).toContain("queue IN ('draft pick')");
  });

  test("bounds concurrent competition analysis work", async () => {
    let active = 0;
    let peak = 0;
    await Promise.all(
      [1, 2, 3, 4].map(
        async (index) =>
          await cachedCompetitionAnalysis(
            `bounded-${index.toString()}`,
            async () => {
              active++;
              peak = Math.max(peak, active);
              await new Promise<void>((resolve) => {
                setTimeout(resolve, 5);
              });
              active--;
              return {
                preset: "criterion_score",
                mode: "selected_period",
                standings: [],
                visualization: null,
                rowsScanned: 0,
              };
            },
          ),
      ),
    );
    expect(peak).toBe(2);
  });
});

async function runMatchAnalysis(criteria: CompetitionCriteria) {
  const { alpha, beta, competition } = await setupCompetition(criteria);
  await writeTestLake(lakeDir, {
    serverId,
    matchFacts: [
      fact({
        playerId: alpha.id,
        playerAlias: "Alpha",
        matchId: "alpha-1",
        queue: "solo",
        win: true,
        championId: targetChampionId,
        date: "2026-05-12",
      }),
      fact({
        playerId: alpha.id,
        playerAlias: "Alpha",
        matchId: "alpha-2",
        queue: "solo",
        win: true,
        championId: targetChampionId,
        date: "2026-05-13",
      }),
      fact({
        playerId: alpha.id,
        playerAlias: "Alpha",
        matchId: "alpha-flex",
        queue: "flex",
        win: true,
        championId: targetChampionId,
        date: "2026-05-14",
      }),
      fact({
        playerId: alpha.id,
        playerAlias: "Alpha",
        matchId: "alpha-old",
        queue: "solo",
        win: true,
        championId: targetChampionId,
        date: "2026-05-02",
      }),
      fact({
        playerId: beta.id,
        playerAlias: "Beta",
        matchId: "beta-1",
        queue: "solo",
        win: false,
        championId: ChampionIdSchema.parse(22),
        date: "2026-05-15",
      }),
    ],
  });
  return await analyzeCompetition({
    prisma,
    competition,
    mode: "selected_period",
    preset: "criterion_score",
    startDate: "2026-05-10",
    endDate: "2026-05-20",
    history: [],
    official: null,
    now,
  });
}

async function runRankAnalysis(criteria: CompetitionCriteria) {
  const { alpha, beta, competition } = await setupCompetition(criteria);
  const history: CachedLeaderboard[] = [
    leaderboard(competition.id, "2026-05-09T00:00:00.000Z", [
      [alpha.id, "Alpha", 1000, 2],
      [beta.id, "Beta", 1200, 1],
    ]),
    leaderboard(competition.id, "2026-05-21T00:00:00.000Z", [
      [alpha.id, "Alpha", 1800, 1],
      [beta.id, "Beta", 1300, 2],
    ]),
    leaderboard(competition.id, "2026-05-20T00:00:00.000Z", [
      [alpha.id, "Alpha", 1400, 1],
      [beta.id, "Beta", 1250, 2],
    ]),
  ];
  return await analyzeCompetition({
    prisma,
    competition,
    mode: "selected_period",
    preset: "criterion_score",
    startDate: "2026-05-10",
    endDate: "2026-05-20",
    history,
    official: null,
    now,
  });
}

async function setupCompetition(criteria: CompetitionCriteria) {
  const alpha = await createPlayer("alpha", "Alpha");
  const beta = await createPlayer("beta", "Beta");
  const competition = await createCompetition(prisma, {
    serverId,
    ownerId: testAccountId("808080001"),
    channelId: testChannelId("808080002"),
    title: "Temporal competition",
    description: "Selected-period test",
    visibility: "OPEN",
    maxParticipants: 10,
    dates: {
      type: "FIXED_DATES",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-31T23:59:59.999Z"),
    },
    criteria,
  });
  await prisma.competitionParticipant.createMany({
    data: [alpha.id, beta.id].map((playerId) => ({
      competitionId: competition.id,
      playerId,
      status: "JOINED",
      joinedAt: new Date("2026-05-01T00:00:00.000Z"),
    })),
  });
  return { alpha, beta, competition };
}

function createPlayer(key: string, alias: string) {
  const accountId = key === "alpha" ? "808080101" : "808080102";
  return prisma.player.create({
    data: {
      discordId: testAccountId(accountId),
      alias,
      serverId,
      creatorDiscordId: testAccountId(accountId),
      createdTime: now,
      updatedTime: now,
      accounts: {
        create: {
          puuid: testPuuid(`competition-analysis-${key}`),
          alias,
          region: "AMERICA_NORTH",
          serverId,
          creatorDiscordId: testAccountId(accountId),
          createdTime: now,
          updatedTime: now,
        },
      },
    },
  });
}

function fact(input: {
  playerId: number;
  playerAlias: string;
  matchId: string;
  queue: string;
  win: boolean;
  championId: number;
  date: string;
}) {
  return {
    playerId: input.playerId,
    playerAlias: input.playerAlias,
    matchId: input.matchId,
    puuid: testPuuid(`fact-${input.matchId}`),
    queue: input.queue,
    win: input.win,
    surrendered: false,
    kills: input.win ? 5 : 1,
    deaths: input.win ? 1 : 5,
    assists: 5,
    championId: input.championId,
    gameCreationAt: new Date(`${input.date}T12:00:00.000Z`),
  };
}

function leaderboard(
  competitionId: CompetitionId,
  calculatedAt: string,
  entries: [PlayerId, string, number, number][],
): CachedLeaderboard {
  return {
    version: "v1",
    competitionId,
    calculatedAt,
    entries: entries.map(([playerId, playerName, score, rank]) => ({
      playerId,
      playerName,
      score,
      rank,
    })),
  };
}

async function cleanup(): Promise<void> {
  await deleteIfExists(() => prisma.competitionParticipant.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
}
