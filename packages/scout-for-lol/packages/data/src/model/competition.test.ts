import { describe, expect, test } from "vitest";
import {
  type CompetitionCriteria,
  CompetitionCriteriaSchema,
  CompetitionConfigurationSchema,
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
  getCompetitionStatus,
  getSnapshotSchemaForCriteria,
} from "#src/model/competition.ts";
import {
  competitionQueueTypeToString,
  participantStatusToString,
  visibilityToString,
} from "#src/model/competition-format.ts";
import { ChampionIdSchema } from "#src/model/identifiers.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "#src/model/discord.ts";
import type { Competition } from "#src/model/competition.ts";
import { QueueTypeSchema } from "#src/model/state.ts";

const SCHEDULE_FIELDS = {
  gameVariant: "MODERN",
  updateCronExpression: null,
  nextScheduledUpdateAt: null,
  lastScheduledUpdateAt: null,
  analysisTimezone: "UTC",
  scheduledUpdatesEnabled: false,
  scheduleTimezone: "UTC",
} satisfies Pick<
  Competition,
  | "updateCronExpression"
  | "nextScheduledUpdateAt"
  | "lastScheduledUpdateAt"
  | "analysisTimezone"
  | "scheduledUpdatesEnabled"
  | "scheduleTimezone"
  | "gameVariant"
>;

const DEFAULT_COMPETITION_NOTIFICATION_FIELDS = {
  startNotifiedAt: null,
  endNotifiedAt: null,
  startNotificationMessageId: null,
  endNotificationMessageId: null,
} as const;

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

  test("accepts CREATE_REPORT", () => {
    const result = PermissionTypeSchema.safeParse("CREATE_REPORT");
    expect(result.success).toBe(true);
  });

  test("rejects invalid values", () => {
    const result = PermissionTypeSchema.safeParse("DELETE_COMPETITION");
    expect(result.success).toBe(false);
  });
});

describe("CompetitionQueueType enum", () => {
  test("accepts every canonical queue", () => {
    for (const queue of QueueTypeSchema.options) {
      expect(CompetitionQueueTypeSchema.safeParse(queue).success).toBe(true);
    }
  });

  test("accepts ALL", () => {
    const result = CompetitionQueueTypeSchema.safeParse("ALL");
    expect(result.success).toBe(true);
  });

  test("rejects invalid values", () => {
    const result = CompetitionQueueTypeSchema.safeParse("NORMALS");
    expect(result.success).toBe(false);
  });

  test("rejects the removed uppercase and ranked-any values", () => {
    expect(CompetitionQueueTypeSchema.safeParse("SOLO").success).toBe(false);
    expect(CompetitionQueueTypeSchema.safeParse("RANKED_ANY").success).toBe(
      false,
    );
  });
});

describe("competition game variant compatibility", () => {
  test("keeps Modern and Classic queues separate", () => {
    expect(
      CompetitionConfigurationSchema.safeParse({
        gameVariant: "MODERN",
        criteria: { type: "MOST_GAMES_PLAYED", queues: ["classic"] },
      }).success,
    ).toBe(false);
    expect(
      CompetitionConfigurationSchema.safeParse({
        gameVariant: "CLASSIC",
        criteria: { type: "MOST_GAMES_PLAYED", queues: ["solo"] },
      }).success,
    ).toBe(false);
  });

  test("allows ALL in either variant and rejects Classic rank criteria", () => {
    for (const gameVariant of ["MODERN", "CLASSIC"] as const) {
      expect(
        CompetitionConfigurationSchema.safeParse({
          gameVariant,
          criteria: { type: "MOST_GAMES_PLAYED", queues: ["ALL"] },
        }).success,
      ).toBe(true);
    }
    expect(
      CompetitionConfigurationSchema.safeParse({
        gameVariant: "CLASSIC",
        criteria: {
          type: "HIGHEST_RANK",
          queues: ["ranked 5s"],
          aggregation: "MAX",
        },
      }).success,
    ).toBe(false);
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
      ...SCHEDULE_FIELDS,
      ...DEFAULT_COMPETITION_NOTIFICATION_FIELDS,
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
  test("formats solo correctly", () => {
    expect(competitionQueueTypeToString("solo")).toBe("Ranked Solo/Duo");
  });

  test("formats flex correctly", () => {
    expect(competitionQueueTypeToString("flex")).toBe("Ranked Flex");
  });

  test("formats ranked 5s correctly", () => {
    expect(competitionQueueTypeToString("ranked 5s")).toBe("Ranked 5s");
  });

  test("formats arena correctly", () => {
    expect(competitionQueueTypeToString("arena")).toBe("Arena");
  });

  test("formats ARAM correctly", () => {
    expect(competitionQueueTypeToString("aram")).toBe("ARAM");
  });

  test("formats ALL correctly", () => {
    expect(competitionQueueTypeToString("ALL")).toBe("All queues");
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
      queues: ["solo"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts all queue types", () => {
    const queues = CompetitionQueueTypeSchema.options;
    for (const queue of queues) {
      const result = MostGamesPlayedCriteriaSchema.safeParse({
        type: "MOST_GAMES_PLAYED",
        queues: [queue],
      });
      expect(result.success).toBe(true);
    }
  });

  test("rejects duplicate queues and ALL combined with a concrete queue", () => {
    expect(
      MostGamesPlayedCriteriaSchema.safeParse({
        type: "MOST_GAMES_PLAYED",
        queues: ["solo", "solo"],
      }).success,
    ).toBe(false);
    expect(
      MostGamesPlayedCriteriaSchema.safeParse({
        type: "MOST_GAMES_PLAYED",
        queues: ["ALL", "solo"],
      }).success,
    ).toBe(false);
  });

  test("rejects an empty queue selection", () => {
    expect(
      MostGamesPlayedCriteriaSchema.safeParse({
        type: "MOST_GAMES_PLAYED",
        queues: [],
      }).success,
    ).toBe(false);
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
      queues: ["solo"],
    });
    expect(result.success).toBe(false);
  });
});

describe("HighestRankCriteria", () => {
  test("accepts SOLO queue", () => {
    const result = HighestRankCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queues: ["solo"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts FLEX queue", () => {
    const result = HighestRankCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queues: ["flex"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects ARENA queue", () => {
    const result = HighestRankCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queues: ["arena"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects ARAM queue", () => {
    const result = HighestRankCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queues: ["aram"],
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
      queues: ["solo"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts FLEX queue", () => {
    const result = MostRankClimbCriteriaSchema.safeParse({
      type: "MOST_RANK_CLIMB",
      queues: ["flex"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects ARENA queue", () => {
    const result = MostRankClimbCriteriaSchema.safeParse({
      type: "MOST_RANK_CLIMB",
      queues: ["arena"],
    });
    expect(result.success).toBe(false);
  });

  test("accepts multiple ranked queues", () => {
    const result = MostRankClimbCriteriaSchema.safeParse({
      type: "MOST_RANK_CLIMB",
      queues: ["solo", "flex", "ranked 5s"],
    });
    expect(result.success).toBe(true);
  });
});

describe("MostWinsPlayerCriteria", () => {
  test("accepts valid criteria with SOLO queue", () => {
    const result = MostWinsPlayerCriteriaSchema.safeParse({
      type: "MOST_WINS_PLAYER",
      queues: ["solo"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts all queue types", () => {
    const queues = CompetitionQueueTypeSchema.options;
    for (const queue of queues) {
      const result = MostWinsPlayerCriteriaSchema.safeParse({
        type: "MOST_WINS_PLAYER",
        queues: [queue],
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
      queues: ["solo"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts valid criteria with championId only (no queue)", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: 157,
      queues: ["ALL"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing championId", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      queues: ["solo"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects negative championId", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: -1,
      queues: ["solo"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects zero championId", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: 0,
      queues: ["solo"],
    });
    expect(result.success).toBe(false);
  });

  test("accepts large championId", () => {
    const result = MostWinsChampionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: 999,
      queues: ["arena"],
    });
    expect(result.success).toBe(true);
  });
});

describe("HighestWinRateCriteria", () => {
  test("accepts valid criteria with minGames", () => {
    const result = HighestWinRateCriteriaSchema.safeParse({
      type: "HIGHEST_WIN_RATE",
      minGames: 20,
      queues: ["solo"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minGames).toBe(20);
    }
  });

  test("applies default minGames of 10 when not provided", () => {
    const result = HighestWinRateCriteriaSchema.safeParse({
      type: "HIGHEST_WIN_RATE",
      queues: ["flex"],
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
      queues: ["solo"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects zero minGames", () => {
    const result = HighestWinRateCriteriaSchema.safeParse({
      type: "HIGHEST_WIN_RATE",
      minGames: 0,
      queues: ["solo"],
    });
    expect(result.success).toBe(false);
  });

  test("accepts all queue types", () => {
    const queues = CompetitionQueueTypeSchema.options;
    for (const queue of queues) {
      const result = HighestWinRateCriteriaSchema.safeParse({
        type: "HIGHEST_WIN_RATE",
        minGames: 15,
        queues: [queue],
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("CompetitionCriteria discriminated union", () => {
  test("parses MOST_GAMES_PLAYED criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "MOST_GAMES_PLAYED",
      queues: ["solo"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("MOST_GAMES_PLAYED");
      expect(result.data.queues).toEqual(["solo"]);
    }
  });

  test("parses HIGHEST_RANK criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queues: ["flex"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("HIGHEST_RANK");
      expect(result.data.queues).toEqual(["flex"]);
    }
  });

  test("parses MOST_RANK_CLIMB criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "MOST_RANK_CLIMB",
      queues: ["solo"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("MOST_RANK_CLIMB");
      expect(result.data.queues).toEqual(["solo"]);
    }
  });

  test("parses MOST_WINS_PLAYER criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "MOST_WINS_PLAYER",
      queues: ["arena"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("MOST_WINS_PLAYER");
      expect(result.data.queues).toEqual(["arena"]);
    }
  });

  test("parses MOST_WINS_CHAMPION criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "MOST_WINS_CHAMPION",
      championId: 157,
      queues: ["solo"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("MOST_WINS_CHAMPION");
      if (result.data.type === "MOST_WINS_CHAMPION") {
        expect(result.data.championId).toBe(ChampionIdSchema.parse(157));
        expect(result.data.queues).toEqual(["solo"]);
      }
    }
  });

  test("parses HIGHEST_WIN_RATE criteria", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "HIGHEST_WIN_RATE",
      minGames: 25,
      queues: ["flex"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("HIGHEST_WIN_RATE");
      if (result.data.type === "HIGHEST_WIN_RATE") {
        expect(result.data.minGames).toBe(25);
        expect(result.data.queues).toEqual(["flex"]);
      }
    }
  });

  test("fails with invalid criteria type", () => {
    const result = CompetitionCriteriaSchema.safeParse({
      type: "INVALID_TYPE",
      queues: ["solo"],
    });
    expect(result.success).toBe(false);
  });

  test("HIGHEST_RANK only allows SOLO or FLEX", () => {
    const invalid = CompetitionCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queues: ["arena"],
    });
    expect(invalid.success).toBe(false);

    const valid = CompetitionCriteriaSchema.safeParse({
      type: "HIGHEST_RANK",
      queues: ["solo"],
      aggregation: "MAX",
    });
    expect(valid.success).toBe(true);
  });

  test("TypeScript type narrowing works correctly", () => {
    const criteria = CompetitionCriteriaSchema.parse({
      type: "MOST_WINS_CHAMPION",
      championId: 157,
      queues: ["solo"],
    });

    // TypeScript should narrow the type based on discriminator
    if (criteria.type === "MOST_WINS_CHAMPION") {
      // This should compile without errors - championId exists on this type
      expect(criteria.championId).toBe(ChampionIdSchema.parse(157));
      expect(criteria.queues).toEqual(["solo"]);
    } else {
      // This branch should never be reached
      expect(true).toBe(false);
    }
  });

  test("Each criteria type has distinct properties", () => {
    const criteria1 = CompetitionCriteriaSchema.parse({
      type: "HIGHEST_RANK",
      queues: ["solo"],
      aggregation: "MAX",
    });
    expect(criteria1.type).toBe("HIGHEST_RANK");

    const criteria2 = CompetitionCriteriaSchema.parse({
      type: "MOST_WINS_CHAMPION",
      championId: 157,
      queues: ["ALL"],
    });
    expect(criteria2.type).toBe("MOST_WINS_CHAMPION");
    // Verify type narrowing allows access to type-specific fields
    if (criteria2.type === "MOST_WINS_CHAMPION") {
      expect(criteria2.championId).toBe(ChampionIdSchema.parse(157));
    }

    const criteria3 = CompetitionCriteriaSchema.parse({
      type: "HIGHEST_WIN_RATE",
      queues: ["flex"],
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
      queues: ["solo"],
    };
    const result = WinsSnapshotDataSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  test("accepts wins with championId", () => {
    const data = {
      wins: 8,
      games: 12,
      championId: 157,
      queues: ["flex"],
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
      queues: ["INVALID_QUEUE"],
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
      queues: ["solo"],
      aggregation: "MAX",
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(RankSnapshotDataSchema);
  });

  test("returns RankSnapshotDataSchema for MOST_RANK_CLIMB", () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_RANK_CLIMB",
      queues: ["flex"],
      aggregation: "MAX",
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(RankSnapshotDataSchema);
  });

  test("returns GamesPlayedSnapshotDataSchema for MOST_GAMES_PLAYED", () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queues: ["solo", "flex"],
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(GamesPlayedSnapshotDataSchema);
  });

  test("returns WinsSnapshotDataSchema for MOST_WINS_PLAYER", () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_WINS_PLAYER",
      queues: ["arena"],
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(WinsSnapshotDataSchema);
  });

  test("returns WinsSnapshotDataSchema for MOST_WINS_CHAMPION", () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_WINS_CHAMPION",
      championId: ChampionIdSchema.parse(157),
      queues: ["ALL"],
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(WinsSnapshotDataSchema);
  });

  test("returns WinsSnapshotDataSchema for HIGHEST_WIN_RATE", () => {
    const criteria: CompetitionCriteria = {
      type: "HIGHEST_WIN_RATE",
      minGames: 10,
      queues: ["solo"],
    };
    const schema = getSnapshotSchemaForCriteria(criteria);
    expect(schema).toBe(WinsSnapshotDataSchema);
  });

  test("factory returns working schema - HIGHEST_RANK", () => {
    const criteria: CompetitionCriteria = {
      type: "HIGHEST_RANK",
      queues: ["solo"],
      aggregation: "MAX",
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
      queues: ["ALL"],
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
      queues: ["solo"],
    };
    const schema = getSnapshotSchemaForCriteria(criteria);

    const validData = {
      wins: 20,
      games: 30,
      championId: ChampionIdSchema.parse(157),
      queues: ["solo"],
    };
    const result = schema.safeParse(validData);
    expect(result.success).toBe(true);
  });
});
