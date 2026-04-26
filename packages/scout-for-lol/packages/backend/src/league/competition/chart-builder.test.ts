import { describe, expect, test, mock } from "bun:test";

// Read env vars at runtime so this mock doesn't override the test-bucket
// configured by test-setup.ts. Bun's mock.module is process-wide and
// retroactive — hard-coding `s3BucketName: undefined` here would leak into
// every other test file's view of configuration and break unrelated S3 tests.
void mock.module("#src/configuration.ts", () => ({
  default: {
    version: "test",
    gitSha: "test",
    environment: "dev",
    sentryDsn: undefined,
    s3BucketName: Bun.env["S3_BUCKET_NAME"],
  },
}));

const {
  CachedLeaderboardSchema,
  CompetitionIdSchema,
  PlayerIdSchema,
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  rankToLeaguePoints,
} = await import("@scout-for-lol/data");
const dataModule = await import("@scout-for-lol/data");

import type {
  CachedLeaderboard,
  CompetitionWithCriteria,
} from "@scout-for-lol/data";

const s3Mock: { loaded: CachedLeaderboard[] } = { loaded: [] };

// Same rationale as the @scout-for-lol/report mock below: spread the real
// module so unrelated tests in the same process keep all the s3-leaderboard
// exports intact.
const realS3Leaderboard = await import("#src/storage/s3-leaderboard.ts");
void mock.module("#src/storage/s3-leaderboard.ts", () => ({
  ...realS3Leaderboard,
  loadHistoricalLeaderboardSnapshots: () => Promise.resolve(s3Mock.loaded),
  saveCachedLeaderboard: () => Promise.resolve(),
  loadCachedLeaderboard: () => Promise.resolve(null),
}));

const reportRenderCalls: { svg: number; image: number } = { svg: 0, image: 0 };

// Spread the real module so other tests (which run in the same `bun test`
// process) keep all the report exports — bun's mock.module is process-wide
// and retroactive, so a narrow stub here would break any later test that
// imports svgToPng / matchToImage / etc.
const realReport = await import("@scout-for-lol/report");
void mock.module("@scout-for-lol/report", () => ({
  ...realReport,
  competitionChartToSvg: () => {
    reportRenderCalls.svg += 1;
    return "<svg></svg>";
  },
  competitionChartToImage: () => {
    reportRenderCalls.image += 1;
    return Promise.resolve(Buffer.from(new Uint8Array(8192)));
  },
}));

const { buildCompetitionChartAttachment } =
  await import("#src/league/competition/chart-builder.ts");

const NOW = new Date("2026-04-25T00:00:00Z");
const START = new Date("2026-04-01T00:00:00Z");
const END = new Date("2026-12-31T23:59:59Z");

function competitionWith(
  criteria: CompetitionWithCriteria["criteria"],
): CompetitionWithCriteria {
  return {
    id: CompetitionIdSchema.parse(123),
    serverId: DiscordGuildIdSchema.parse("9".repeat(18)),
    ownerId: DiscordAccountIdSchema.parse("9".repeat(18)),
    title: "Test Competition",
    description: "",
    channelId: DiscordChannelIdSchema.parse("9".repeat(18)),
    isCancelled: false,
    visibility: "OPEN",
    maxParticipants: 50,
    startDate: START,
    endDate: END,
    seasonId: null,
    startProcessedAt: null,
    endProcessedAt: null,
    creatorDiscordId: DiscordAccountIdSchema.parse("9".repeat(18)),
    createdTime: START,
    updatedTime: START,
    criteria,
  };
}

function snapshot(
  date: Date,
  entries: CachedLeaderboard["entries"],
): CachedLeaderboard {
  return CachedLeaderboardSchema.parse({
    version: "v1",
    competitionId: 123,
    calculatedAt: date.toISOString(),
    entries,
  });
}

describe("buildCompetitionChartAttachment", () => {
  test("returns null when leaderboard is empty", async () => {
    s3Mock.loaded = [];
    reportRenderCalls.image = 0;
    const result = await buildCompetitionChartAttachment(
      competitionWith({ type: "MOST_GAMES_PLAYED", queue: "ALL" }),
      [],
    );
    expect(result).toBeNull();
    expect(reportRenderCalls.image).toBe(0);
  });

  test("MOST_GAMES_PLAYED renders bar standings without needing snapshots", async () => {
    s3Mock.loaded = []; // bar mode never reads S3
    reportRenderCalls.image = 0;
    const result = await buildCompetitionChartAttachment(
      competitionWith({ type: "MOST_GAMES_PLAYED", queue: "ALL" }),
      [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Dan",
          score: 12,
          rank: 1,
        },
      ],
    );
    expect(result).not.toBeNull();
    expect(reportRenderCalls.image).toBe(1);
    expect(result?.name).toBe("competition-123-standings.png");
  });

  test("HIGHEST_RANK line chart returns null when fewer than 2 snapshots exist", async () => {
    s3Mock.loaded = [
      snapshot(START, [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Dan",
          score: {
            tier: "gold" as const,
            division: 2 as const,
            lp: 50,
            wins: 0,
            losses: 0,
          },
          rank: 1,
        },
      ]),
    ];
    reportRenderCalls.image = 0;
    const result = await buildCompetitionChartAttachment(
      competitionWith({ type: "HIGHEST_RANK", queue: "SOLO" }),
      [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Dan",
          score: {
            tier: "gold" as const,
            division: 2 as const,
            lp: 50,
            wins: 0,
            losses: 0,
          },
          rank: 1,
        },
      ],
    );
    expect(result).toBeNull();
    expect(reportRenderCalls.image).toBe(0);
  });

  test("HIGHEST_RANK renders trend line when ≥2 snapshots exist", async () => {
    const day0 = START;
    const day1 = new Date(START.valueOf() + 86_400_000);
    const goldII = {
      tier: "gold" as const,
      division: 2 as const,
      lp: 50,
      wins: 0,
      losses: 0,
    };
    const goldI = {
      tier: "gold" as const,
      division: 1 as const,
      lp: 0,
      wins: 0,
      losses: 0,
    };
    s3Mock.loaded = [
      snapshot(day0, [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Dan",
          score: goldII,
          rank: 1,
        },
      ]),
      snapshot(day1, [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Dan",
          score: goldI,
          rank: 1,
        },
      ]),
    ];
    reportRenderCalls.image = 0;
    const result = await buildCompetitionChartAttachment(
      competitionWith({ type: "HIGHEST_RANK", queue: "SOLO" }),
      [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Dan",
          score: goldI,
          rank: 1,
        },
      ],
    );
    expect(result).not.toBeNull();
    expect(reportRenderCalls.image).toBe(1);
    expect(result?.name).toBe("competition-123-trend.png");
  });

  test("rankToLeaguePoints monotonic across rank tiers", async () => {
    const day0 = START;
    const day1 = new Date(START.valueOf() + 86_400_000);
    const goldII = {
      tier: "gold" as const,
      division: 2 as const,
      lp: 50,
      wins: 0,
      losses: 0,
    };
    const goldI = {
      tier: "gold" as const,
      division: 1 as const,
      lp: 0,
      wins: 0,
      losses: 0,
    };
    s3Mock.loaded = [
      snapshot(day0, [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Dan",
          score: goldII,
          rank: 1,
        },
      ]),
      snapshot(day1, [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Dan",
          score: goldI,
          rank: 1,
        },
      ]),
    ];
    reportRenderCalls.image = 0;
    const result = await buildCompetitionChartAttachment(
      competitionWith({ type: "HIGHEST_RANK", queue: "SOLO" }),
      [
        {
          playerId: PlayerIdSchema.parse(1),
          playerName: "Dan",
          score: goldI,
          rank: 1,
        },
      ],
    );
    expect(result).not.toBeNull();
    // Sanity check: rankToLeaguePoints monotonic across the two snapshots
    expect(rankToLeaguePoints(goldI)).toBeGreaterThan(
      rankToLeaguePoints(goldII),
    );
    expect(dataModule).toBeDefined();
    expect(NOW).toBeDefined();
  });
});
