import { describe, expect, test } from "bun:test";
import {
  ChampionIdSchema,
  type CompetitionCriteria,
  CompetitionCriteriaSchema,
  CompetitionIdSchema,
  CompetitionQueueTypeSchema,
  CompetitionVisibilitySchema,
  GamesPlayedSnapshotDataSchema,
  HighestRankCriteriaSchema,
  HighestWinRateCriteriaSchema,
  MostGamesPlayedCriteriaSchema,
  MostRankClimbCriteriaSchema,
  MostWinsChampionCriteriaSchema,
  MostWinsPlayerCriteriaSchema,
  ParticipantIdSchema,
  ParticipantStatusSchema,
  PermissionTypeSchema,
  RankSnapshotDataSchema,
  SnapshotTypeSchema,
  WinsSnapshotDataSchema,
  competitionQueueTypeToString,
  getCompetitionStatus,
  getSnapshotSchemaForCriteria,
  parseCompetition,
  participantStatusToString,
  visibilityToString,
} from "@scout-for-lol/data/model/competition";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data/model/discord";
import type { Competition } from "@scout-for-lol/backend/generated/prisma/client/index.js";

describe("CompetitionId branded type", () => {
  test("accepts positive integers", () => {
    const result = CompetitionIdSchema.safeParse(1);
    expect(result.success).toBe(true);
  });

  test("accepts large positive integers", () => {
    const result = CompetitionIdSchema.safeParse(999_999);
    expect(result.success).toBe(true);
  });

  test("rejects negative integers", () => {
    const result = CompetitionIdSchema.safeParse(-1);
    expect(result.success).toBe(false);
  });

  test("rejects zero", () => {
    const result = CompetitionIdSchema.safeParse(0);
    expect(result.success).toBe(false);
  });

  test("rejects floats", () => {
    const result = CompetitionIdSchema.safeParse(1.5);
    expect(result.success).toBe(false);
  });

  test("rejects strings", () => {
    const result = CompetitionIdSchema.safeParse("1");
    expect(result.success).toBe(false);
  });
});

describe("ParticipantId branded type", () => {
  test("accepts positive integers", () => {
    const result = ParticipantIdSchema.safeParse(42);
    expect(result.success).toBe(true);
  });

  test("rejects negative integers", () => {
    const result = ParticipantIdSchema.safeParse(-5);
    expect(result.success).toBe(false);
  });

  test("rejects zero", () => {
    const result = ParticipantIdSchema.safeParse(0);
    expect(result.success).toBe(false);
  });

  // Note: TypeScript prevents assigning CompetitionId to ParticipantId at compile time
  // due to branding, but at runtime they're both numbers
});

describe("CompetitionVisibility enum", () => {
  test("accepts OPEN", () => {
    const result = CompetitionVisibilitySchema.safeParse("OPEN");
    expect(result.success).toBe(true);
  });

  test("accepts INVITE_ONLY", () => {
    const result = CompetitionVisibilitySchema.safeParse("INVITE_ONLY");
    expect(result.success).toBe(true);
  });

  test("accepts SERVER_WIDE", () => {
    const result = CompetitionVisibilitySchema.safeParse("SERVER_WIDE");
    expect(result.success).toBe(true);
  });

  test("rejects invalid values", () => {
    const result = CompetitionVisibilitySchema.safeParse("INVALID");
    expect(result.success).toBe(false);
  });

  test("rejects lowercase", () => {
    const result = CompetitionVisibilitySchema.safeParse("open");
    expect(result.success).toBe(false);
  });
});

describe("ParticipantStatus enum", () => {
  test("accepts INVITED", () => {
    const result = ParticipantStatusSchema.safeParse("INVITED");
    expect(result.success).toBe(true);
  });

  test("accepts JOINED", () => {
    const result = ParticipantStatusSchema.safeParse("JOINED");
    expect(result.success).toBe(true);
  });

  test("accepts LEFT", () => {
    const result = ParticipantStatusSchema.safeParse("LEFT");
    expect(result.success).toBe(true);
  });

  test("rejects invalid values", () => {
    const result = ParticipantStatusSchema.safeParse("PENDING");
    expect(result.success).toBe(false);
  });
});

describe("SnapshotType enum", () => {
  test("accepts START", () => {
    const result = SnapshotTypeSchema.safeParse("START");
    expect(result.success).toBe(true);
  });

  test("accepts END", () => {
    const result = SnapshotTypeSchema.safeParse("END");
    expect(result.success).toBe(true);
  });

  test("rejects invalid values", () => {
    const result = SnapshotTypeSchema.safeParse("MIDDLE");
    expect(result.success).toBe(false);
  });
});

describe("PermissionType enum", () => {
  test("accepts CREATE_COMPETITION", () => {
    const result = PermissionTypeSchema.safeParse("CREATE_COMPETITION");
    expect(result.success).toBe(true);
  });

  test("rejects invalid values", () => {
    const result = PermissionTypeSchema.safeParse("DELETE_COMPETITION");
    expect(result.success).toBe(false);
  });
});

describe("CompetitionQueueType enum", () => {
  test("accepts SOLO", () => {
    const result = CompetitionQueueTypeSchema.safeParse("SOLO");
    expect(result.success).toBe(true);
  });

  test("accepts FLEX", () => {
    const result = CompetitionQueueTypeSchema.safeParse("FLEX");
    expect(result.success).toBe(true);
  });

  test("accepts RANKED_ANY", () => {
    const result = CompetitionQueueTypeSchema.safeParse("RANKED_ANY");
    expect(result.success).toBe(true);
  });

  test("accepts ARENA", () => {
    const result = CompetitionQueueTypeSchema.safeParse("ARENA");
    expect(result.success).toBe(true);
  });

  test("accepts ARAM", () => {
    const result = CompetitionQueueTypeSchema.safeParse("ARAM");
    expect(result.success).toBe(true);
  });

  test("accepts ALL", () => {
    const result = CompetitionQueueTypeSchema.safeParse("ALL");
    expect(result.success).toBe(true);
  });

  test("rejects invalid values", () => {
    const result = CompetitionQueueTypeSchema.safeParse("NORMALS");
    expect(result.success).toBe(false);
  });
});

describe("getCompetitionStatus - CANCELLED", () => {
  test("returns CANCELLED when isCancelled is true (with future dates)", () => {
    const competition: Competition = {
      isCancelled: true,
      startDate: new Date("2025-06-01"),
      endDate: new Date("2025-07-01"),
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("CANCELLED");
  });

  test("returns CANCELLED when isCancelled is true (with past dates)", () => {
    const competition: Competition = {
      isCancelled: true,
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-02-01"),
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("CANCELLED");
  });

  test("returns CANCELLED when isCancelled is true (with current dates)", () => {
    const now = new Date();
    const competition: Competition = {
      isCancelled: true,
      startDate: new Date(now.getTime() - 86_400_000), // Yesterday
      endDate: new Date(now.getTime() + 86_400_000), // Tomorrow
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("CANCELLED");
  });

  test("returns CANCELLED when isCancelled is true (with seasonId)", () => {
    const competition: Competition = {
      isCancelled: true,
      startDate: null,
      endDate: null,
      seasonId: "2025_SEASON_3_ACT_1",
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("CANCELLED");
  });
});

describe("getCompetitionStatus - DRAFT", () => {
  test("returns DRAFT when startDate is in the future", () => {
    const now = new Date();
    const competition: Competition = {
      isCancelled: false,
      startDate: new Date(now.getTime() + 86_400_000), // Tomorrow
      endDate: new Date(now.getTime() + 86_400_000 * 7), // Next week
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("DRAFT");
  });

  test("returns DRAFT when only seasonId is set", () => {
    const competition: Competition = {
      isCancelled: false,
      startDate: null,
      endDate: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      seasonId: "2025_SEASON_3_ACT_1",
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("DRAFT");
  });

  test("returns DRAFT when startDate is exactly now (edge case)", () => {
    const now = new Date();
    const competition: Competition = {
      isCancelled: false,
      startDate: new Date(now.getTime() + 1000), // 1 second in future
      endDate: new Date(now.getTime() + 86_400_000),
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("DRAFT");
  });
});

describe("getCompetitionStatus - ACTIVE", () => {
  test("returns ACTIVE when startDate is in past and endDate is in future", () => {
    const now = new Date();
    const competition: Competition = {
      isCancelled: false,
      startDate: new Date(now.getTime() - 86_400_000), // Yesterday
      endDate: new Date(now.getTime() + 86_400_000), // Tomorrow
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("ACTIVE");
  });

  test("returns ACTIVE when just started (edge case)", () => {
    const now = new Date();
    const competition: Competition = {
      isCancelled: false,
      startDate: new Date(now.getTime() - 1000), // 1 second ago
      endDate: new Date(now.getTime() + 86_400_000),
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("ACTIVE");
  });
});

describe("getCompetitionStatus - ENDED", () => {
  test("returns ENDED when endDate is in past", () => {
    const now = new Date();
    const competition: Competition = {
      isCancelled: false,
      startDate: new Date(now.getTime() - 86_400_000 * 7), // Last week
      endDate: new Date(now.getTime() - 86_400_000), // Yesterday
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN" as const,
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("ENDED");
  });

  test("returns ENDED when just ended (edge case)", () => {
    const now = new Date();
    const competition: Competition = {
      isCancelled: false,
      startDate: new Date(now.getTime() - 86_400_000 * 7),
      endDate: new Date(now.getTime() - 1000), // 1 second ago
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("ENDED");
  });

  test("returns ENDED when endDate is exactly now", () => {
    const now = new Date();
    const competition: Competition = {
      isCancelled: false,
      startDate: new Date(now.getTime() - 86_400_000),
      endDate: now,
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(getCompetitionStatus(competition)).toBe("ENDED");
  });
});

describe("getCompetitionStatus - Error cases", () => {
  test("throws error when no dates and no seasonId", () => {
    const competition: Competition = {
      isCancelled: false,
      startDate: null,
      endDate: null,
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    expect(() => getCompetitionStatus(competition)).toThrow(
      "Competition must have either (startDate AND endDate) OR seasonId",
    );
  });

  test("error message is descriptive", () => {
    const competition: Competition = {
      isCancelled: false,
      startDate: null,
      endDate: null,
      seasonId: null,
      startProcessedAt: null,
      endProcessedAt: null,
      id: CompetitionIdSchema.parse(1),
      updatedTime: new Date(),
      createdTime: new Date(),
      creatorDiscordId: DiscordAccountIdSchema.parse("12345678901234567"),
      visibility: "OPEN",
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: "{}",
      maxParticipants: 10,
      serverId: DiscordGuildIdSchema.parse("12345678901234567"),
      ownerId: DiscordAccountIdSchema.parse("12345678901234567"),
      title: "Test Competition",
      description: "Test Description",
      channelId: DiscordChannelIdSchema.parse("12345678901234567"),
    };
    try {
      getCompetitionStatus(competition);
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      const errorMessage = String(error);
      expect(errorMessage).toContain("startDate AND endDate");
      expect(errorMessage).toContain("seasonId");
    }
  });
});

describe("competitionQueueTypeToString", () => {
  test("formats SOLO correctly", () => {
    expect(competitionQueueTypeToString("SOLO")).toBe("Solo Queue");
  });

  test("formats FLEX correctly", () => {
    expect(competitionQueueTypeToString("FLEX")).toBe("Flex Queue");
  });

  test("formats RANKED_ANY correctly", () => {
    expect(competitionQueueTypeToString("RANKED_ANY")).toBe("Ranked (Any)");
  });

  test("formats ARENA correctly", () => {
    expect(competitionQueueTypeToString("ARENA")).toBe("Arena");
  });

  test("formats ARAM correctly", () => {
    expect(competitionQueueTypeToString("ARAM")).toBe("ARAM");
  });

  test("formats ALL correctly", () => {
    expect(competitionQueueTypeToString("ALL")).toBe("All Queues");
  });
});

describe("visibilityToString", () => {
  test("formats OPEN correctly", () => {
    expect(visibilityToString("OPEN")).toBe("Open to All");
  });

  test("formats INVITE_ONLY correctly", () => {
    expect(visibilityToString("INVITE_ONLY")).toBe("Invite Only");
  });

  test("formats SERVER_WIDE correctly", () => {
    expect(visibilityToString("SERVER_WIDE")).toBe("Server-Wide");
  });
});

describe("participantStatusToString", () => {
  test("formats INVITED correctly", () => {
    expect(participantStatusToString("INVITED")).toBe("Invited");
  });

  test("formats JOINED correctly", () => {
    expect(participantStatusToString("JOINED")).toBe("Joined");
  });

  test("formats LEFT correctly", () => {
    expect(participantStatusToString("LEFT")).toBe("Left");
  });
});

// ============================================================================
// Competition Criteria Tests
// ============================================================================

describe("MostGamesPlayedCriteria", () => {
  test("accepts valid criteria with SOLO queue", () => {
    const result = MostGamesPlayedCriteriaSchema.safeParse({
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    });
    expect(result.success).toBe(true);
  });

  test("accepts all queue types", () => {
    const queues = ["SOLO", "FLEX", "RANKED_ANY", "ARENA", "ARAM", "ALL"];
    for (const queue of queues) {
      const result = MostGamesPlayedCriteriaSchema.safeParse({
        type: "MOST_GAMES_PLAYED",
        queue,
      });
      expect(result.success).toBe(true);
    }
  });

  test("rejects missing queue field", () => {
    const result = MostGamesPlayedCriteriaSchema.safeParse({
      type: "MOST_GAMES_PLAYED",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid queue type", () => {
    const result = MostGamesPlayedCriteriaSchema.safeParse({
      type: "MOST_GAMES_PLAYED",
      queue: "INVALID_QUEUE",
    });
    expect(result.success).toBe(false);
  });

  test("rejects wrong type discriminator", () => {
    const result = MostGamesPlayedCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queue: "SOLO",
    });
    expect(result.success).toBe(false);
  });
});

describe("HighestRankCriteria", () => {
  test("accepts SOLO queue", () => {
    const result = HighestRankCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queue: "SOLO",
    });
    expect(result.success).toBe(true);
  });

  test("accepts FLEX queue", () => {
    const result = HighestRankCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queue: "FLEX",
    });
    expect(result.success).toBe(true);
  });

  test("rejects ARENA queue", () => {
    const result = HighestRankCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queue: "ARENA",
    });
    expect(result.success).toBe(false);
  });

  test("rejects ARAM queue", () => {
    const result = HighestRankCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queue: "ARAM",
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing queue field", () => {
    const result = HighestRankCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
    });
    expect(result.success).toBe(false);
  });
});

describe("MostRankClimbCriteria", () => {
  test("accepts SOLO queue", () => {
    const result = MostRankClimbCriteriaSchema.safeParse({
      type: "MOST_RANK_CLIMB",
      queue: "SOLO",
    });
    expect(result.success).toBe(true);
  });

  test("accepts FLEX queue", () => {
    const result = MostRankClimbCriteriaSchema.safeParse({
      type: "MOST_RANK_CLIMB",
      queue: "FLEX",
    });
    expect(result.success).toBe(true);
  });

  test("rejects ARENA queue", () => {
    const result = MostRankClimbCriteriaSchema.safeParse({
      type: "MOST_RANK_CLIMB",
      queue: "ARENA",
    });
    expect(result.success).toBe(false);
  });

  test("rejects RANKED_ANY queue", () => {
    const result = MostRankClimbCriteriaSchema.safeParse({
      type: "MOST_RANK_CLIMB",
      queue: "RANKED_ANY",
    });
    expect(result.success).toBe(false);
  });
});

describe("MostWinsPlayerCriteria", () => {
  test("accepts valid criteria with SOLO queue", () => {
    const result = MostWinsPlayerCriteriaSchema.safeParse({
      type: "MOST_WINS_PLAYER",
      queue: "SOLO",
    });
    expect(result.success).toBe(true);
  });

  test("accepts all queue types", () => {
    const queues = ["SOLO", "FLEX", "RANKED_ANY", "ARENA", "ARAM", "ALL"];
    for (const queue of queues) {
      const result = MostWinsPlayerCriteriaSchema.safeParse({
        type: "MOST_WINS_PLAYER",
        queue,
      });
      expect(result.success).toBe(true);
    }
  });

  test("rejects missing queue field", () => {
    const result = MostWinsPlayerCriteriaSchema.safeParse({
      type: "MOST_WINS_PLAYER",
    });
    expect(result.success).toBe(false);
  });
});

describe("MostWinsChampionCriteria", () => {
  test("accepts valid criteria with championId and queue", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: 157, // Yasuo
      queue: "SOLO",
    });
    expect(result.success).toBe(true);
  });

  test("accepts valid criteria with championId only (no queue)", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: 157,
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing championId", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      queue: "SOLO",
    });
    expect(result.success).toBe(false);
  });

  test("rejects negative championId", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: -1,
      queue: "SOLO",
    });
    expect(result.success).toBe(false);
  });

  test("rejects zero championId", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: 0,
      queue: "SOLO",
    });
    expect(result.success).toBe(false);
  });

  test("accepts large championId", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: 999,
      queue: "ARENA",
    });
    expect(result.success).toBe(true);
  });
});

describe("HighestWinRateCriteria", () => {
  test("accepts valid criteria with minGames", () => {
    const result = HighestWinRateCriteriaSchema.safeParse({
      type: "HIGHEST_WIN_RATE",
      minGames: 20,
      queue: "SOLO",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minGames).toBe(20);
    }
  });

  test("applies default minGames of 10 when not provided", () => {
    const result = HighestWinRateCriteriaSchema.safeParse({
      type: "HIGHEST_WIN_RATE",
      queue: "FLEX",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minGames).toBe(10);
    }
  });

  test("rejects negative minGames", () => {
    const result = HighestWinRateCriteriaSchema.safeParse({
      type: "HIGHEST_WIN_RATE",
      minGames: -5,
      queue: "SOLO",
    });
    expect(result.success).toBe(false);
  });

  test("rejects zero minGames", () => {
    const result = HighestWinRateCriteriaSchema.safeParse({
      type: "HIGHEST_WIN_RATE",
      minGames: 0,
      queue: "SOLO",
    });
    expect(result.success).toBe(false);
  });

  test("accepts all queue types", () => {
    const queues = ["SOLO", "FLEX", "RANKED_ANY", "ARENA", "ARAM", "ALL"];
    for (const queue of queues) {
      const result = HighestWinRateCriteriaSchema.safeParse({
        type: "HIGHEST_WIN_RATE",
        minGames: 15,
        queue,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("CompetitionCriteria discriminated union", () => {
  test("parses MOST_GAMES_PLAYED criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("MOST_GAMES_PLAYED");
      expect(result.data.queue).toBe("SOLO");
    }
  });

  test("parses HIGHEST_RANK criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queue: "FLEX",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("HIGHEST_RANK");
      expect(result.data.queue).toBe("FLEX");
    }
  });

  test("parses MOST_RANK_CLIMB criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "MOST_RANK_CLIMB",
      queue: "SOLO",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("MOST_RANK_CLIMB");
      expect(result.data.queue).toBe("SOLO");
    }
  });

  test("parses MOST_WINS_PLAYER criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "MOST_WINS_PLAYER",
      queue: "ARENA",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("MOST_WINS_PLAYER");
      expect(result.data.queue).toBe("ARENA");
    }
  });

  test("parses MOST_WINS_CHAMPION criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: 157,
      queue: "SOLO",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("MOST_WINS_CHAMPION");
      if (result.data.type === "MOST_WINS_CHAMPION") {
        expect(result.data.championId).toBe(ChampionIdSchema.parse(157));
        expect(result.data.queue).toBe("SOLO");
      }
    }
  });

  test("parses HIGHEST_WIN_RATE criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "HIGHEST_WIN_RATE",
      minGames: 25,
      queue: "FLEX",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("HIGHEST_WIN_RATE");
      if (result.data.type === "HIGHEST_WIN_RATE") {
        expect(result.data.minGames).toBe(25);
        expect(result.data.queue).toBe("FLEX");
      }
    }
  });

  test("fails with invalid criteria type", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "INVALID_TYPE",
      queue: "SOLO",
    });
    expect(result.success).toBe(false);
  });

  test("HIGHEST_RANK only allows SOLO or FLEX", () => {
    const invalid = CompetitionCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queue: "ARENA",
    });
    expect(invalid.success).toBe(false);

    const valid = CompetitionCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queue: "SOLO",
    });
    expect(valid.success).toBe(true);
  });

  test("TypeScript type narrowing works correctly", () => {
    const criteria = CompetitionCriteriaSchema.parse({
      type: "MOST_WINS_CHAMPION",
      championId: 157,
      queue: "SOLO",
    });

    // TypeScript should narrow the type based on discriminator
    if (criteria.type === "MOST_WINS_CHAMPION") {
      // This should compile without errors - championId exists on this type
      expect(criteria.championId).toBe(ChampionIdSchema.parse(157));
      expect(criteria.queue).toBe("SOLO");
    } else {
      // This branch should never be reached
      expect(true).toBe(false);
    }
  });

  test("Each criteria type has distinct properties", () => {
    const criteria1 = CompetitionCriteriaSchema.parse({
      type: "HIGHEST_RANK",
      queue: "SOLO",
    });
    expect(criteria1.type).toBe("HIGHEST_RANK");

    const criteria2 = CompetitionCriteriaSchema.parse({
      type: "MOST_WINS_CHAMPION",
      championId: 157,
    });
    expect(criteria2.type).toBe("MOST_WINS_CHAMPION");
    // Verify type narrowing allows access to type-specific fields
    if (criteria2.type === "MOST_WINS_CHAMPION") {
      expect(criteria2.championId).toBe(ChampionIdSchema.parse(157));
    }

    const criteria3 = CompetitionCriteriaSchema.parse({
      type: "HIGHEST_WIN_RATE",
      queue: "FLEX",
    });
    expect(criteria3.type).toBe("HIGHEST_WIN_RATE");
    if (criteria3.type === "HIGHEST_WIN_RATE") {
      expect(criteria3.minGames).toBe(10); // default value
    }
  });
});

// ============================================================================
// Snapshot Data Schemas
// ============================================================================

describe("RankSnapshotDataSchema", () => {
  test("accepts valid solo rank data", () => {
    const data = {
      solo: {
        tier: "diamond",
        division: 2, // II
        lp: 67,
        wins: 50,
        losses: 45,
      },
    };
    const result = RankSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("accepts valid flex rank data", () => {
    const data = {
      flex: {
        tier: "gold",
        division: 1, // I
        lp: 0,
        wins: 20,
        losses: 18,
      },
    };
    const result = RankSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("accepts both ranks together", () => {
    const data = {
      solo: {
        tier: "platinum",
        division: 3, // III
        lp: 45,
        wins: 100,
        losses: 95,
      },
      flex: {
        tier: "diamond",
        division: 4, // IV
        lp: 12,
        wins: 30,
        losses: 25,
      },
    };
    const result = RankSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("accepts empty object (both ranks optional)", () => {
    const data = {};
    const result = RankSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("rejects negative LP", () => {
    const data = {
      solo: {
        tier: "gold",
        division: 2,
        lp: -10,
        wins: 50,
        losses: 45,
      },
    };
    const result = RankSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects invalid tier", () => {
    const data = {
      solo: {
        tier: "INVALID_TIER",
        division: 2,
        lp: 45,
        wins: 50,
        losses: 45,
      },
    };
    const result = RankSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects invalid division (0)", () => {
    const data = {
      solo: {
        tier: "gold",
        division: 0,
        lp: 50,
        wins: 50,
        losses: 45,
      },
    };
    const result = RankSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects invalid division (5)", () => {
    const data = {
      solo: {
        tier: "gold",
        division: 5,
        lp: 50,
        wins: 50,
        losses: 45,
      },
    };
    const result = RankSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects missing required fields", () => {
    const data = {
      solo: {
        tier: "gold",
        division: 2,
        // missing lp, wins, losses
      },
    };
    const result = RankSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("accepts Master tier with high LP", () => {
    const data = {
      solo: {
        tier: "master",
        division: 1,
        lp: 500, // Master+ can have LP > 100
        wins: 200,
        losses: 180,
      },
    };
    const result = RankSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

describe("GamesPlayedSnapshotDataSchema", () => {
  test("accepts valid games data with all queues", () => {
    const data = {
      soloGames: 50,
      flexGames: 25,
      arenaGames: 10,
      aramGames: 100,
    };
    const result = GamesPlayedSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("rejects games data with missing queues", () => {
    const data = {
      soloGames: 30,
      arenaGames: 5,
    };
    const result = GamesPlayedSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects empty object (all queues required)", () => {
    const data = {};
    const result = GamesPlayedSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("accepts zero games", () => {
    const data = {
      soloGames: 0,
      flexGames: 0,
      arenaGames: 0,
      aramGames: 0,
    };
    const result = GamesPlayedSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("rejects negative games", () => {
    const data = {
      soloGames: -5,
      flexGames: 10,
      arenaGames: 5,
      aramGames: 20,
    };
    const result = GamesPlayedSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects non-integer games", () => {
    const data = {
      soloGames: 10.5,
      flexGames: 20,
      arenaGames: 5,
      aramGames: 10,
    };
    const result = GamesPlayedSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe("WinsSnapshotDataSchema", () => {
  test("accepts valid wins data", () => {
    const data = {
      wins: 30,
      games: 50,
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("accepts wins without championId", () => {
    const data = {
      wins: 15,
      games: 25,
      queue: "SOLO",
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("accepts wins with championId", () => {
    const data = {
      wins: 8,
      games: 12,
      championId: 157,
      queue: "FLEX",
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("accepts wins = games (100% win rate)", () => {
    const data = {
      wins: 20,
      games: 20,
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("accepts wins = 0", () => {
    const data = {
      wins: 0,
      games: 10,
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("rejects negative wins", () => {
    const data = {
      wins: -5,
      games: 20,
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects negative games", () => {
    const data = {
      wins: 10,
      games: -20,
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects non-integer wins", () => {
    const data = {
      wins: 10.5,
      games: 20,
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects missing wins field", () => {
    const data = {
      games: 50,
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("rejects missing games field", () => {
    const data = {
      wins: 30,
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  test("accepts wins > games at schema level (validation happens elsewhere)", () => {
    // Schema doesn't enforce wins <= games, that's business logic
    const data = {
      wins: 60,
      games: 50,
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("rejects zero or negative championId", () => {
    const data1 = {
      wins: 5,
      games: 10,
      championId: 0,
    };
    expect(WinsSnapshotDataSchema.safeParse(data1).success).toBe(false);

    const data2 = {
      wins: 5,
      games: 10,
      championId: -1,
    };
    expect(WinsSnapshotDataSchema.safeParse(data2).success).toBe(false);
  });

  test("rejects invalid queue type", () => {
    const data = {
      wins: 10,
      games: 20,
      queue: "INVALID_QUEUE",
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Snapshot Schema Factory
// ============================================================================

describe("getSnapshotSchemaForCriteria", () => {
  test("returns RankSnapshotDataSchema for HIGHEST_RANK", () => {
    const criteria: CompetitionCriteria = {
      type: "HIGHEST_RANK",
      queue: "SOLO",
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(RankSnapshotDataSchema);
  });

  test("returns RankSnapshotDataSchema for MOST_RANK_CLIMB", () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_RANK_CLIMB",
      queue: "FLEX",
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(RankSnapshotDataSchema);
  });

  test("returns GamesPlayedSnapshotDataSchema for MOST_GAMES_PLAYED", () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "RANKED_ANY",
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(GamesPlayedSnapshotDataSchema);
  });

  test("returns WinsSnapshotDataSchema for MOST_WINS_PLAYER", () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_WINS_PLAYER",
      queue: "ARENA",
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(WinsSnapshotDataSchema);
  });

  test("returns WinsSnapshotDataSchema for MOST_WINS_CHAMPION", () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_WINS_CHAMPION",
      championId: ChampionIdSchema.parse(157),
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(WinsSnapshotDataSchema);
  });

  test("returns WinsSnapshotDataSchema for HIGHEST_WIN_RATE", () => {
    const criteria: CompetitionCriteria = {
      type: "HIGHEST_WIN_RATE",
      minGames: 10,
      queue: "SOLO",
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(WinsSnapshotDataSchema);
  });

  test("factory returns working schema - HIGHEST_RANK", () => {
    const criteria: CompetitionCriteria = {
      type: "HIGHEST_RANK",
      queue: "SOLO",
    };
    const schema = getSnapshotSchemaForCriteria(criteria);

    const validData = {
      solo: {
        tier: "gold",
        division: 2, // II
        lp: 45,
        wins: 50,
        losses: 45,
      },
    };
    const result = schema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  test("factory returns working schema - MOST_GAMES_PLAYED", () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "ALL",
    };
    const schema = getSnapshotSchemaForCriteria(criteria);

    const validData = {
      soloGames: 50,
      flexGames: 25,
      arenaGames: 10,
      aramGames: 100,
    };
    const result = schema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  test("factory returns working schema - MOST_WINS_CHAMPION", () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_WINS_CHAMPION",
      championId: ChampionIdSchema.parse(157),
      queue: "SOLO",
    };
    const schema = getSnapshotSchemaForCriteria(criteria);

    const validData = {
      wins: 20,
      games: 30,
      championId: ChampionIdSchema.parse(157),
      queue: "SOLO",
    };
    const result = schema.safeParse(validData);
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// parseCompetition - Database to Domain Type Conversion
// ============================================================================

describe("parseCompetition", () => {
  const baseRawCompetition: Competition = {
    id: CompetitionIdSchema.parse(42),
    serverId: DiscordGuildIdSchema.parse("123456789012345678"),
    ownerId: DiscordAccountIdSchema.parse("987654321098765432"),
    title: "Test Competition",
    description: "A test competition",
    channelId: DiscordChannelIdSchema.parse("111222333444555666"),
    isCancelled: false,
    visibility: "OPEN",
    criteriaType: "MOST_GAMES_PLAYED",
    criteriaConfig: JSON.stringify({ queue: "SOLO" }),
    maxParticipants: 50,
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-01-31"),
    seasonId: null,
    startProcessedAt: null,
    endProcessedAt: null,
    creatorDiscordId: DiscordAccountIdSchema.parse("987654321098765432"),
    createdTime: new Date("2024-12-01"),
    updatedTime: new Date("2024-12-01"),
  };

  test("parses MOST_GAMES_PLAYED criteria correctly", () => {
    const raw: Competition = {
      ...baseRawCompetition,
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: JSON.stringify({ queue: "SOLO" }),
    };

    const parsed = parseCompetition(raw);

    expect(parsed.id).toBe(CompetitionIdSchema.parse(42));
    expect(parsed.title).toBe("Test Competition");
    expect(parsed.criteria).toEqual({
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    });
  });

  test("parses HIGHEST_RANK criteria correctly", () => {
    const raw: Competition = {
      ...baseRawCompetition,
      criteriaType: "HIGHEST_RANK",
      criteriaConfig: JSON.stringify({ queue: "FLEX" }),
    };

    const parsed = parseCompetition(raw);

    expect(parsed.criteria).toEqual({
      type: "HIGHEST_RANK",
      queue: "FLEX",
    });
  });

  test("parses MOST_WINS_CHAMPION criteria correctly", () => {
    const raw: Competition = {
      ...baseRawCompetition,
      criteriaType: "MOST_WINS_CHAMPION",
      criteriaConfig: JSON.stringify({
        championId: ChampionIdSchema.parse(157),
        queue: "SOLO",
      }),
    };

    const parsed = parseCompetition(raw);

    expect(parsed.criteria).toEqual({
      type: "MOST_WINS_CHAMPION",
      championId: ChampionIdSchema.parse(157),
      queue: "SOLO",
    });
  });

  test("parses HIGHEST_WIN_RATE criteria with default minGames", () => {
    const raw: Competition = {
      ...baseRawCompetition,
      criteriaType: "HIGHEST_WIN_RATE",
      criteriaConfig: JSON.stringify({ queue: "FLEX" }),
    };

    const parsed = parseCompetition(raw);

    expect(parsed.criteria).toEqual({
      type: "HIGHEST_WIN_RATE",
      minGames: 10, // default value
      queue: "FLEX",
    });
  });

  test("preserves all original fields except criteriaType and criteriaConfig", () => {
    const parsed = parseCompetition(baseRawCompetition);

    expect(parsed.id).toBe(baseRawCompetition.id);
    expect(parsed.serverId).toBe(baseRawCompetition.serverId);
    expect(parsed.ownerId).toBe(baseRawCompetition.ownerId);
    expect(parsed.title).toBe(baseRawCompetition.title);
    expect(parsed.description).toBe(baseRawCompetition.description);
    expect(parsed.channelId).toBe(baseRawCompetition.channelId);
    expect(parsed.isCancelled).toBe(baseRawCompetition.isCancelled);
    expect(parsed.visibility).toBe(baseRawCompetition.visibility);
    expect(parsed.maxParticipants).toBe(baseRawCompetition.maxParticipants);
    expect(parsed.startDate).toBe(baseRawCompetition.startDate);
    expect(parsed.endDate).toBe(baseRawCompetition.endDate);
    expect(parsed.seasonId).toBe(baseRawCompetition.seasonId);
    expect(parsed.creatorDiscordId).toBe(baseRawCompetition.creatorDiscordId);
    expect(parsed.createdTime).toBe(baseRawCompetition.createdTime);
    expect(parsed.updatedTime).toBe(baseRawCompetition.updatedTime);

    // Should not have these fields
    expect("criteriaType" in parsed).toBe(false);
    expect("criteriaConfig" in parsed).toBe(false);

    // Should have criteria instead
    expect(parsed.criteria).toBeDefined();
  });

  test("throws on invalid JSON in criteriaConfig", () => {
    const raw: Competition = {
      ...baseRawCompetition,
      criteriaConfig: "{ invalid json",
    };

    expect(() => parseCompetition(raw)).toThrow(/Invalid criteriaConfig JSON/);
  });

  test("throws when criteriaConfig is not an object", () => {
    const raw: Competition = {
      ...baseRawCompetition,
      criteriaConfig: JSON.stringify("not an object"),
    };

    expect(() => parseCompetition(raw)).toThrow(
      /criteriaConfig must be an object/,
    );
  });

  test("throws when criteriaConfig is null", () => {
    const raw: Competition = {
      ...baseRawCompetition,
      criteriaConfig: JSON.stringify(null),
    };

    expect(() => parseCompetition(raw)).toThrow(
      /criteriaConfig must be an object/,
    );
  });

  test("throws when criteriaType doesn't match config", () => {
    const raw: Competition = {
      ...baseRawCompetition,
      criteriaType: "MOST_WINS_CHAMPION",
      criteriaConfig: JSON.stringify({ queue: "SOLO" }), // missing championId
    };

    expect(() => parseCompetition(raw)).toThrow(/Invalid criteria/);
  });

  test("throws when criteria has missing required fields", () => {
    const raw: Competition = {
      ...baseRawCompetition,
      criteriaType: "MOST_GAMES_PLAYED",
      criteriaConfig: JSON.stringify({}), // missing queue
    };

    expect(() => parseCompetition(raw)).toThrow(/Invalid criteria/);
  });

  test("throws when criteria has invalid queue for HIGHEST_RANK", () => {
    const raw: Competition = {
      ...baseRawCompetition,
      criteriaType: "HIGHEST_RANK",
      criteriaConfig: JSON.stringify({ queue: "ARENA" }), // not SOLO/FLEX
    };

    expect(() => parseCompetition(raw)).toThrow(/Invalid criteria/);
  });
});
