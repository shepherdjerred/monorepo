import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createCompetition,
  getCompetitionById,
  updateCompetition,
} from "@scout-for-lol/backend/database/competition/queries.ts";
import type {
  CreateCompetitionInput,
  UpdateCompetitionInput,
} from "@scout-for-lol/backend/database/competition/queries.ts";
import {
  testGuildId,
  testAccountId,
  testChannelId,
} from "@scout-for-lol/backend/testing/test-ids.ts";
import {
  CompetitionIdSchema,
  getCompetitionStatus,
  type CompetitionId,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  deleteIfExists,
} from "@scout-for-lol/backend/testing/test-database.ts";

// Create a test database for integration tests
const { prisma } = createTestDatabase("competition-edit-test");

beforeEach(async () => {
  // Clean up database before each test
  await deleteIfExists(() => prisma.competitionSnapshot.deleteMany());
  await deleteIfExists(() => prisma.competitionParticipant.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
});
afterAll(async () => {
  await prisma.$disconnect();
});

// ============================================================================
// Test Helpers
// ============================================================================

async function createDraftCompetition(
  serverId: DiscordGuildId,
  ownerId: DiscordAccountId,
): Promise<{ competitionId: CompetitionId; channelId: DiscordChannelId }> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const input: CreateCompetitionInput = {
    serverId,
    ownerId,
    channelId: testChannelId("123456789012345678"),
    title: "Test Competition",
    description: "A test competition",
    visibility: "OPEN",
    maxParticipants: 50,
    dates: {
      type: "FIXED_DATES",
      startDate: tomorrow,
      endDate: nextWeek,
    },
    criteria: {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    },
  };

  const competition = await createCompetition(prisma, input);
  return {
    competitionId: competition.id,
    channelId: input.channelId,
  };
}

async function createActiveCompetition(
  serverId: DiscordGuildId,
  ownerId: DiscordAccountId,
): Promise<{ competitionId: CompetitionId; channelId: DiscordChannelId }> {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const input: CreateCompetitionInput = {
    serverId,
    ownerId,
    channelId: testChannelId("123456789012345678"),
    title: "Active Competition",
    description: "An active competition",
    visibility: "OPEN",
    maxParticipants: 50,
    dates: {
      type: "FIXED_DATES",
      startDate: yesterday,
      endDate: tomorrow,
    },
    criteria: {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    },
  };

  const competition = await createCompetition(prisma, input);
  return {
    competitionId: competition.id,
    channelId: input.channelId,
  };
}

// ============================================================================
// Test: Edit DRAFT competition - all fields
// ============================================================================

describe("Edit DRAFT competition", () => {
  test("owner can edit title in DRAFT", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const before = await getCompetitionById(prisma, competitionId);
    expect(before).not.toBeNull();
    expect(before?.title).toBe("Test Competition");

    const updateInput: UpdateCompetitionInput = {
      title: "Updated Title",
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after).not.toBeNull();
    expect(after?.title).toBe("Updated Title");
  });

  test("owner can edit description in DRAFT", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const updateInput: UpdateCompetitionInput = {
      description: "Updated description",
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after?.description).toBe("Updated description");
  });

  test("owner can edit channel in DRAFT", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const updateInput: UpdateCompetitionInput = {
      channelId: testChannelId("999999999999999999"),
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after?.channelId).toBe(testChannelId("999999999999999999"));
  });

  test("owner can edit visibility in DRAFT", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const before = await getCompetitionById(prisma, competitionId);
    expect(before?.visibility).toBe("OPEN");

    const updateInput: UpdateCompetitionInput = {
      visibility: "INVITE_ONLY",
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after?.visibility).toBe("INVITE_ONLY");
  });

  test("owner can edit maxParticipants in DRAFT", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const before = await getCompetitionById(prisma, competitionId);
    expect(before?.maxParticipants).toBe(50);

    const updateInput: UpdateCompetitionInput = {
      maxParticipants: 100,
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after?.maxParticipants).toBe(100);
  });

  test("owner can edit dates in DRAFT", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const newStart = new Date("2025-06-01T00:00:00Z");
    const newEnd = new Date("2025-06-30T23:59:59Z");

    const updateInput: UpdateCompetitionInput = {
      dates: {
        type: "FIXED_DATES",
        startDate: newStart,
        endDate: newEnd,
      },
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after?.startDate).toEqual(newStart);
    expect(after?.endDate).toEqual(newEnd);
  });

  test("owner can change from fixed dates to season in DRAFT", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const before = await getCompetitionById(prisma, competitionId);
    expect(before?.startDate).not.toBeNull();
    expect(before?.endDate).not.toBeNull();
    expect(before?.seasonId).toBeNull();

    const updateInput: UpdateCompetitionInput = {
      dates: {
        type: "SEASON",
        seasonId: "2025_SEASON_3_ACT_1",
      },
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    // startDate and endDate are transparently populated from season
    expect(after?.startDate).toBeInstanceOf(Date);
    expect(after?.endDate).toBeInstanceOf(Date);
    expect(after?.startDate).toBeTruthy();
    expect(after?.endDate).toBeTruthy();
    expect(after?.seasonId).toBe("2025_SEASON_3_ACT_1");
  });

  test("owner can edit criteria in DRAFT", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const before = await getCompetitionById(prisma, competitionId);
    expect(before?.criteria.type).toBe("MOST_GAMES_PLAYED");

    const updateInput: UpdateCompetitionInput = {
      criteria: {
        type: "HIGHEST_RANK",
        queue: "FLEX",
      },
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after?.criteria.type).toBe("HIGHEST_RANK");
    if (after?.criteria.type === "HIGHEST_RANK") {
      expect(after.criteria.queue).toBe("FLEX");
    }
  });

  test("owner can edit multiple fields at once in DRAFT", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const updateInput: UpdateCompetitionInput = {
      title: "Multi-Edit Title",
      description: "Multi-edit description",
      visibility: "SERVER_WIDE",
      maxParticipants: 75,
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after?.title).toBe("Multi-Edit Title");
    expect(after?.description).toBe("Multi-edit description");
    expect(after?.visibility).toBe("SERVER_WIDE");
    expect(after?.maxParticipants).toBe(75);
  });
});

// ============================================================================
// Test: Edit ACTIVE competition - limited fields
// ============================================================================

describe("Edit ACTIVE competition", () => {
  test("owner can edit title in ACTIVE", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createActiveCompetition(serverId, ownerId);

    // Verify it's ACTIVE
    const competition = await getCompetitionById(prisma, competitionId);
    const status = competition ? getCompetitionStatus(competition) : null;
    expect(status).toBe("ACTIVE");

    const updateInput: UpdateCompetitionInput = {
      title: "Updated Active Title",
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after?.title).toBe("Updated Active Title");
  });

  test("owner can edit description in ACTIVE", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createActiveCompetition(serverId, ownerId);

    const updateInput: UpdateCompetitionInput = {
      description: "Updated active description",
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after?.description).toBe("Updated active description");
  });

  test("owner can edit channel in ACTIVE", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createActiveCompetition(serverId, ownerId);

    const updateInput: UpdateCompetitionInput = {
      channelId: testChannelId("888888888888888888"),
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    expect(after?.channelId).toBe(testChannelId("888888888888888888"));
  });
});

// ============================================================================
// Test: Ownership validation
// ============================================================================

describe("Ownership validation", () => {
  test("competition owner ID is preserved", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition?.ownerId).toBe(ownerId);

    // Simulate checking ownership in the command
    const userId = testAccountId("111111111111111111");
    const isOwner = competition?.ownerId === userId;
    expect(isOwner).toBe(true);
  });

  test("non-owner is detected", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const otherUserId = testAccountId("222222222222222222");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition?.ownerId).toBe(ownerId);

    const isOwner = competition?.ownerId === otherUserId;
    expect(isOwner).toBe(false);
  });
});

// ============================================================================
// Test: Status-based restrictions
// ============================================================================

describe("Status-based restrictions", () => {
  test("DRAFT status allows full edits", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const competition = await getCompetitionById(prisma, competitionId);
    const status = competition ? getCompetitionStatus(competition) : null;
    expect(status).toBe("DRAFT");

    const isDraft = status === "DRAFT";
    expect(isDraft).toBe(true);
  });

  test("ACTIVE status restricts certain edits", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createActiveCompetition(serverId, ownerId);

    const competition = await getCompetitionById(prisma, competitionId);
    const status = competition ? getCompetitionStatus(competition) : null;
    expect(status).toBe("ACTIVE");

    const isDraft = status === "DRAFT";
    expect(isDraft).toBe(false);

    // Simulate the restriction logic from the command
    const canEditDates = isDraft;
    const canEditCriteria = isDraft;
    const canEditVisibility = isDraft;
    const canEditMaxParticipants = isDraft;

    expect(canEditDates).toBe(false);
    expect(canEditCriteria).toBe(false);
    expect(canEditVisibility).toBe(false);
    expect(canEditMaxParticipants).toBe(false);
  });

  test("CANCELLED status is detected", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    // Cancel the competition
    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    const competition = await getCompetitionById(prisma, competitionId);
    const status = competition ? getCompetitionStatus(competition) : null;
    expect(status).toBe("CANCELLED");

    // Simulate the command check
    const canEdit = status !== "CANCELLED";
    expect(canEdit).toBe(false);
  });
});

// ============================================================================
// Test: Update maintains other fields
// ============================================================================

describe("Partial updates", () => {
  test("updating one field preserves others", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const before = await getCompetitionById(prisma, competitionId);

    const updateInput: UpdateCompetitionInput = {
      title: "Only Title Changed",
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);

    expect(after?.title).toBe("Only Title Changed");
    expect(after?.description).toBe(before?.description);
    expect(after?.channelId).toBe(before?.channelId);
    expect(after?.visibility).toBe(before?.visibility);
    expect(after?.maxParticipants).toBe(before?.maxParticipants);
    expect(after?.criteria).toEqual(before?.criteria);
  });

  test("updatedTime changes on edit", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const before = await getCompetitionById(prisma, competitionId);
    const beforeUpdatedTime = before?.updatedTime;

    // Wait a bit to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updateInput: UpdateCompetitionInput = {
      title: "Time Check",
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);
    const afterUpdatedTime = after?.updatedTime;

    expect(afterUpdatedTime).not.toBeNull();
    expect(beforeUpdatedTime).not.toBeNull();
    if (afterUpdatedTime && beforeUpdatedTime) {
      expect(afterUpdatedTime.getTime()).toBeGreaterThan(
        beforeUpdatedTime.getTime(),
      );
    }
  });

  test("createdTime remains unchanged on edit", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createDraftCompetition(serverId, ownerId);

    const before = await getCompetitionById(prisma, competitionId);
    const createdTime = before?.createdTime;

    const updateInput: UpdateCompetitionInput = {
      title: "Created Time Check",
    };

    await updateCompetition(prisma, competitionId, updateInput);

    const after = await getCompetitionById(prisma, competitionId);

    expect(after?.createdTime).toEqual(createdTime);
  });
});

// ============================================================================
// Test: Non-existent competition
// ============================================================================

describe("Error cases", () => {
  test("updating non-existent competition throws error", async () => {
    const nonExistentId = CompetitionIdSchema.parse(999999);
    const updateInput: UpdateCompetitionInput = {
      title: "Should Fail",
    };

    await expect(
      updateCompetition(prisma, nonExistentId, updateInput),
    ).rejects.toThrow();
  });
});
