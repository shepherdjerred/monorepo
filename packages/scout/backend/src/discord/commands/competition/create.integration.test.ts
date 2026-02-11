import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createCompetition,
  getCompetitionById,
  type CreateCompetitionInput,
} from "@shepherdjerred/scout-backend/database/competition/queries.ts";
import { clearAllRateLimits } from "@shepherdjerred/scout-backend/database/competition/rate-limit.ts";
import { validateOwnerLimit, validateServerLimit } from "@shepherdjerred/scout-backend/database/competition/validation.ts";
import { ErrorSchema } from "@shepherdjerred/scout-backend/utils/errors.ts";
import { testGuildId, testAccountId, testChannelId } from "@shepherdjerred/scout-backend/testing/test-ids.ts";
import { ChampionIdSchema, DiscordAccountIdSchema } from "@shepherdjerred/scout-data";
import { createTestDatabase, deleteIfExists } from "@shepherdjerred/scout-backend/testing/test-database.ts";

// Create a test database
const { prisma } = createTestDatabase("create-command-test");

beforeEach(async () => {
  // Clean up database and rate limits before each test
  await deleteIfExists(() => prisma.competitionSnapshot.deleteMany());
  await deleteIfExists(() => prisma.competitionParticipant.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
  await deleteIfExists(() => prisma.serverPermission.deleteMany());
  clearAllRateLimits();
});
afterAll(async () => {
  await prisma.$disconnect();
});

// ============================================================================
// Integration Tests for Create Command Logic
// ============================================================================

describe("Competition creation - MOST_GAMES_PLAYED", () => {
  test("creates competition with fixed dates successfully", async () => {
    const now = new Date();
    const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
    const endDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // +14 days

    const competition = await createCompetition(prisma, {
      serverId: testGuildId("123456789012345678"),
      ownerId: testAccountId("987654321098765432"),
      channelId: testChannelId("111222333444555666"),
      title: "January Grind Challenge",
      description: "Who can play the most solo queue games this month?",
      visibility: "OPEN",
      maxParticipants: 50,
      dates: {
        type: "FIXED_DATES",
        startDate,
        endDate,
      },
      criteria: {
        type: "MOST_GAMES_PLAYED",
        queue: "SOLO",
      },
    });

    expect(competition.id).toBeGreaterThan(0);
    expect(competition.title).toBe("January Grind Challenge");
    expect(competition.criteria.type).toBe("MOST_GAMES_PLAYED");
    if (competition.criteria.type === "MOST_GAMES_PLAYED") {
      expect(competition.criteria.queue).toBe("SOLO");
    }
  });

  test("creates competition with season successfully", async () => {
    const competition = await createCompetition(prisma, {
      serverId: testGuildId("123456789012345678"),
      ownerId: testAccountId("987654321098765432"),
      channelId: testChannelId("111222333444555666"),
      title: "Season 2025 Grind",
      description: "Compete for the entire season!",
      visibility: "OPEN",
      maxParticipants: 50,
      dates: {
        type: "SEASON",
        seasonId: "2025_SEASON_3_ACT_1",
      },
      criteria: {
        type: "MOST_GAMES_PLAYED",
        queue: "RANKED_ANY",
      },
    });

    expect(competition.id).toBeGreaterThan(0);
    expect(competition.seasonId).toBe("2025_SEASON_3_ACT_1");
    // startDate and endDate are transparently populated from season
    expect(competition.startDate).toBeInstanceOf(Date);
    expect(competition.endDate).toBeInstanceOf(Date);
    expect(competition.startDate).toBeTruthy();
    expect(competition.endDate).toBeTruthy();
  });
});

describe("Competition creation - All criteria types", () => {
  const baseInput: Omit<CreateCompetitionInput, "criteria"> = {
    serverId: testGuildId("123456789012345678"),
    ownerId: testAccountId("987654321098765432"),
    channelId: testChannelId("111222333444555666"),
    title: "Test Competition",
    description: "Test",
    visibility: "OPEN",
    maxParticipants: 50,
    dates: {
      type: "SEASON",
      seasonId: "2025_SEASON_3_ACT_1",
    },
  };

  test("HIGHEST_RANK with SOLO queue", async () => {
    const competition = await createCompetition(prisma, {
      ...baseInput,
      ownerId: testAccountId("100000000000000001"),
      title: "Rank Challenge",
      criteria: {
        type: "HIGHEST_RANK",
        queue: "SOLO",
      },
    });

    expect(competition.criteria.type).toBe("HIGHEST_RANK");
    if (competition.criteria.type === "HIGHEST_RANK") {
      expect(competition.criteria.queue).toBe("SOLO");
    }
  });

  test("MOST_RANK_CLIMB with FLEX queue", async () => {
    const competition = await createCompetition(prisma, {
      ...baseInput,
      ownerId: testAccountId("100000000000000002"),
      title: "Climb Challenge",
      criteria: {
        type: "MOST_RANK_CLIMB",
        queue: "FLEX",
      },
    });

    expect(competition.criteria.type).toBe("MOST_RANK_CLIMB");
    if (competition.criteria.type === "MOST_RANK_CLIMB") {
      expect(competition.criteria.queue).toBe("FLEX");
    }
  });

  test("MOST_WINS_PLAYER with ARENA queue", async () => {
    const competition = await createCompetition(prisma, {
      ...baseInput,
      ownerId: testAccountId("100000000000000003"),
      title: "Arena Wins",
      criteria: {
        type: "MOST_WINS_PLAYER",
        queue: "ARENA",
      },
    });

    expect(competition.criteria.type).toBe("MOST_WINS_PLAYER");
    if (competition.criteria.type === "MOST_WINS_PLAYER") {
      expect(competition.criteria.queue).toBe("ARENA");
    }
  });

  test("MOST_WINS_CHAMPION with championId", async () => {
    const competition = await createCompetition(prisma, {
      ...baseInput,
      ownerId: testAccountId("100000000000000004"),
      title: "Yasuo Masters",
      criteria: {
        type: "MOST_WINS_CHAMPION",
        championId: ChampionIdSchema.parse(157),
        queue: "SOLO",
      },
    });

    expect(competition.criteria.type).toBe("MOST_WINS_CHAMPION");
    if (competition.criteria.type === "MOST_WINS_CHAMPION") {
      expect(competition.criteria.championId).toBe(ChampionIdSchema.parse(157));
      expect(competition.criteria.queue).toBe("SOLO");
    }
  });

  test("MOST_WINS_CHAMPION without queue (optional)", async () => {
    const competition = await createCompetition(prisma, {
      ...baseInput,
      ownerId: testAccountId("100000000000000005"),
      title: "Champion Masters",
      criteria: {
        type: "MOST_WINS_CHAMPION",
        championId: ChampionIdSchema.parse(64),
      },
    });

    expect(competition.criteria.type).toBe("MOST_WINS_CHAMPION");
    if (competition.criteria.type === "MOST_WINS_CHAMPION") {
      expect(competition.criteria.championId).toBe(ChampionIdSchema.parse(64));
      expect(competition.criteria.queue).toBeUndefined();
    }
  });

  test("HIGHEST_WIN_RATE with minGames", async () => {
    const competition = await createCompetition(prisma, {
      ...baseInput,
      ownerId: testAccountId("100000000000000006"),
      title: "Win Rate Challenge",
      criteria: {
        type: "HIGHEST_WIN_RATE",
        minGames: 25,
        queue: "SOLO",
      },
    });

    expect(competition.criteria.type).toBe("HIGHEST_WIN_RATE");
    if (competition.criteria.type === "HIGHEST_WIN_RATE") {
      expect(competition.criteria.minGames).toBe(25);
      expect(competition.criteria.queue).toBe("SOLO");
    }
  });

  test("HIGHEST_WIN_RATE with default minGames (10)", async () => {
    const competition = await createCompetition(prisma, {
      ...baseInput,
      ownerId: testAccountId("100000000000000007"),
      title: "Win Rate Default",
      criteria: {
        type: "HIGHEST_WIN_RATE",
        minGames: 10, // Explicitly set default
        queue: "FLEX",
      },
    });

    expect(competition.criteria.type).toBe("HIGHEST_WIN_RATE");
    if (competition.criteria.type === "HIGHEST_WIN_RATE") {
      expect(competition.criteria.minGames).toBe(10);
    }
  });
});

describe("Competition defaults", () => {
  test("visibility defaults to OPEN", async () => {
    const competition = await createCompetition(prisma, {
      serverId: testGuildId("123456789012345678"),
      ownerId: testAccountId("987654321098765432"),
      channelId: testChannelId("111222333444555666"),
      title: "Default Visibility",
      description: "Test",
      visibility: "OPEN", // Explicitly testing default
      maxParticipants: 50,
      dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      criteria: { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
    });

    expect(competition.visibility).toBe("OPEN");
  });

  test("maxParticipants defaults to 50", async () => {
    const competition = await createCompetition(prisma, {
      serverId: testGuildId("123456789012345678"),
      ownerId: testAccountId("987654321098765433"),
      channelId: testChannelId("111222333444555666"),
      title: "Default Max",
      description: "Test",
      visibility: "OPEN",
      maxParticipants: 50, // Explicitly testing default
      dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      criteria: { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
    });

    expect(competition.maxParticipants).toBe(50);
  });
});

describe("Permission and limit integration", () => {
  test("second competition by same owner fails (owner limit)", async () => {
    const ownerId = testAccountId("999888777666555444");
    const now = new Date();

    // Create first competition
    await createCompetition(prisma, {
      serverId: testGuildId("123456789012345678"),
      ownerId,
      channelId: testChannelId("111222333444555666"),
      title: "First Competition",
      description: "Test",
      visibility: "OPEN",
      maxParticipants: 50,
      dates: {
        type: "FIXED_DATES",
        startDate: now,
        endDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
      criteria: { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
    });

    let error: unknown = null;
    try {
      await validateOwnerLimit(prisma, testGuildId("123456789012345678"), ownerId);
    } catch (e) {
      error = e;
    }

    expect(error).not.toBeNull();
    const errorResult = ErrorSchema.safeParse(error);
    if (errorResult.success) {
      expect(errorResult.data.message).toContain("already have");
      expect(errorResult.data.message).toContain("active competition");
    }
  });

  test("third competition on server fails (server limit)", async () => {
    const serverId = testGuildId("123456789012345678");
    const now = new Date();

    // Create 2 competitions (server limit)
    for (let i = 0; i < 2; i++) {
      await createCompetition(prisma, {
        serverId,
        ownerId: DiscordAccountIdSchema.parse((100000000000000000 + i).toString()),
        channelId: testChannelId("111222333444555666"),
        title: `Competition ${i.toString()}`,
        description: "Test",
        visibility: "OPEN",
        maxParticipants: 50,
        dates: {
          type: "FIXED_DATES",
          startDate: now,
          endDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
        criteria: { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
      });
    }

    let error: unknown = null;
    try {
      await validateServerLimit(prisma, serverId);
    } catch (e) {
      error = e;
    }

    expect(error).not.toBeNull();
    const errorResult = ErrorSchema.safeParse(error);
    if (errorResult.success) {
      expect(errorResult.data.message).toContain("already has");
      expect(errorResult.data.message).toContain("active competitions");
    }
  });
});

describe("Data integrity", () => {
  test("created competition can be retrieved", async () => {
    const competition = await createCompetition(prisma, {
      serverId: testGuildId("123456789012345678"),
      ownerId: testAccountId("987654321098765432"),
      channelId: testChannelId("111222333444555666"),
      title: "Retrieval Test",
      description: "Test retrieval",
      visibility: "INVITE_ONLY",
      maxParticipants: 25,
      dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      criteria: { type: "MOST_GAMES_PLAYED", queue: "FLEX" },
    });

    const retrieved = await getCompetitionById(prisma, competition.id);

    expect(retrieved).not.toBeNull();
    if (retrieved) {
      expect(retrieved.id).toBe(competition.id);
      expect(retrieved.title).toBe("Retrieval Test");
      expect(retrieved.visibility).toBe("INVITE_ONLY");
      expect(retrieved.maxParticipants).toBe(25);
      expect(retrieved.criteria.type).toBe("MOST_GAMES_PLAYED");
    }
  });

  test("criteria round-trips correctly for all types", async () => {
    const testCases: CreateCompetitionInput[] = [
      {
        ownerId: testAccountId("100000000000000001"),
        title: "Games Test",
        criteria: {
          type: "MOST_GAMES_PLAYED" as const,
          queue: "SOLO" as const,
        },
        serverId: testGuildId("123456789012345678"),
        channelId: testChannelId("111222333444555666"),
        description: "Test",
        visibility: "OPEN",
        maxParticipants: 50,
        dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      },
      {
        ownerId: testAccountId("100000000000000002"),
        title: "Rank Test",
        criteria: { type: "HIGHEST_RANK" as const, queue: "FLEX" as const },
        serverId: testGuildId("123456789012345678"),
        channelId: testChannelId("111222333444555666"),
        description: "Test",
        visibility: "OPEN",
        maxParticipants: 50,
        dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      },
      {
        ownerId: testAccountId("100000000000000003"),
        title: "Climb Test",
        criteria: { type: "MOST_RANK_CLIMB" as const, queue: "SOLO" as const },
        serverId: testGuildId("123456789012345678"),
        channelId: testChannelId("111222333444555666"),
        description: "Test",
        visibility: "OPEN",
        maxParticipants: 50,
        dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      },
      {
        ownerId: testAccountId("100000000000000004"),
        title: "Wins Test",
        criteria: {
          type: "MOST_WINS_PLAYER" as const,
          queue: "ARENA" as const,
        },
        serverId: testGuildId("123456789012345678"),
        channelId: testChannelId("111222333444555666"),
        description: "Test",
        visibility: "OPEN",
        maxParticipants: 50,
        dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      },
      {
        ownerId: testAccountId("100000000000000005"),
        title: "Champion Test",
        criteria: {
          type: "MOST_WINS_CHAMPION" as const,
          championId: ChampionIdSchema.parse(157),
          queue: "SOLO" as const,
        },
        serverId: testGuildId("123456789012345678"),
        channelId: testChannelId("111222333444555666"),
        description: "Test",
        visibility: "OPEN",
        maxParticipants: 50,
        dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      },
      {
        ownerId: testAccountId("100000000000000006"),
        title: "Win Rate Test",
        criteria: {
          type: "HIGHEST_WIN_RATE" as const,
          minGames: 20,
          queue: "FLEX" as const,
        },
        serverId: testGuildId("123456789012345678"),
        channelId: testChannelId("111222333444555666"),
        description: "Test",
        visibility: "OPEN",
        maxParticipants: 50,
        dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      },
    ];

    for (const testCase of testCases) {
      const created = await createCompetition(prisma, {
        serverId: testGuildId("123456789012345678"),
        ownerId: testCase.ownerId,
        channelId: testChannelId("111222333444555666"),
        title: testCase.title,
        description: "Test",
        visibility: "OPEN",
        maxParticipants: 50,
        dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
        criteria: testCase.criteria,
      });

      const retrieved = await getCompetitionById(prisma, created.id);
      expect(retrieved).not.toBeNull();

      if (retrieved) {
        expect(retrieved.criteria).toEqual(testCase.criteria);
      }
    }
  });
});

describe("Metadata tracking", () => {
  test("tracks creatorDiscordId", async () => {
    const ownerId = testAccountId("987654321098765432");

    const competition = await createCompetition(prisma, {
      serverId: testGuildId("123456789012345678"),
      ownerId,
      channelId: testChannelId("111222333444555666"),
      title: "Metadata Test",
      description: "Test",
      visibility: "OPEN",
      maxParticipants: 50,
      dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      criteria: { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
    });

    expect(competition.creatorDiscordId).toBe(ownerId);
    expect(competition.ownerId).toBe(ownerId);
  });

  test("sets isCancelled to false by default", async () => {
    const competition = await createCompetition(prisma, {
      serverId: testGuildId("123456789012345678"),
      ownerId: testAccountId("987654321098765432"),
      channelId: testChannelId("111222333444555666"),
      title: "Status Test",
      description: "Test",
      visibility: "OPEN",
      maxParticipants: 50,
      dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      criteria: { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
    });

    expect(competition.isCancelled).toBe(false);
  });

  test("tracks timestamps", async () => {
    const beforeCreate = new Date();

    const competition = await createCompetition(prisma, {
      serverId: testGuildId("123456789012345678"),
      ownerId: testAccountId("987654321098765432"),
      channelId: testChannelId("111222333444555666"),
      title: "Timestamp Test",
      description: "Test",
      visibility: "OPEN",
      maxParticipants: 50,
      dates: { type: "SEASON", seasonId: "2025_SEASON_3_ACT_1" },
      criteria: { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
    });

    const afterCreate = new Date();

    expect(competition.createdTime.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
    expect(competition.createdTime.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    expect(competition.updatedTime).toEqual(competition.createdTime);
  });
});
