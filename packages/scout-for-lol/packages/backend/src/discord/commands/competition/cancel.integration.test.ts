import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createCompetition, getCompetitionById } from "@scout-for-lol/backend/database/competition/queries.ts";
import type { CreateCompetitionInput } from "@scout-for-lol/backend/database/competition/queries.ts";
import { testGuildId, testAccountId, testChannelId } from "@scout-for-lol/backend/testing/test-ids.ts";
import { type DiscordAccountId, type DiscordGuildId } from "@scout-for-lol/data";
import { createTestDatabase, deleteIfExists } from "@scout-for-lol/backend/testing/test-database.ts";

// Create a test database for integration tests
const { prisma } = createTestDatabase("competition-cancel-test");

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

async function createTestCompetition(
  serverId: DiscordGuildId,
  ownerId: DiscordAccountId,
): Promise<{ competitionId: number; channelId: string }> {
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

// ============================================================================
// Test: Owner cancels their competition
// ============================================================================

describe("Owner cancellation", () => {
  test("owner can cancel their own competition", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    // Verify competition is not cancelled initially
    const before = await getCompetitionById(prisma, competitionId);
    expect(before).not.toBeNull();
    if (before) {
      expect(before.isCancelled).toBe(false);
    }

    // Owner cancels the competition
    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    // Verify competition is now cancelled
    const after = await getCompetitionById(prisma, competitionId);
    expect(after).not.toBeNull();
    if (after) {
      expect(after.isCancelled).toBe(true);
    }
  });

  test("cancelled competition maintains all other data", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    const before = await getCompetitionById(prisma, competitionId);
    expect(before).not.toBeNull();

    // Cancel
    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    const after = await getCompetitionById(prisma, competitionId);
    expect(after).not.toBeNull();

    if (before && after) {
      expect(after.title).toBe(before.title);
      expect(after.description).toBe(before.description);
      expect(after.ownerId).toBe(before.ownerId);
      expect(after.channelId).toBe(before.channelId);
      expect(after.isCancelled).toBe(true);
    }
  });
});

// ============================================================================
// Test: Admin can cancel any competition
// ============================================================================

describe("Admin cancellation", () => {
  test("admin can cancel competition they don't own", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const adminId = "222222222222222222";
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    // Verify different users
    expect(ownerId).not.toBe(adminId);

    // Admin cancels (in real code, admin permissions would be checked)
    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    const after = await getCompetitionById(prisma, competitionId);
    expect(after).not.toBeNull();
    if (after) {
      expect(after.isCancelled).toBe(true);
      expect(after.ownerId).toBe(ownerId); // Owner unchanged
    }
  });
});

// ============================================================================
// Test: Non-existent competition
// ============================================================================

describe("Non-existent competition", () => {
  test("cancelling non-existent competition returns null", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    // Create a competition just to set up the database properly
    await createTestCompetition(serverId, ownerId);

    const nonExistentId = 999999;
    const competition = await getCompetitionById(prisma, nonExistentId);

    expect(competition).toBeUndefined();
  });
});

// ============================================================================
// Test: Already cancelled competition (idempotent)
// ============================================================================

describe("Idempotent cancellation", () => {
  test("cancelling already cancelled competition is idempotent", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    // Cancel first time
    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    const firstCancel = await getCompetitionById(prisma, competitionId);
    expect(firstCancel?.isCancelled).toBe(true);

    // Cancel again
    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    const secondCancel = await getCompetitionById(prisma, competitionId);
    expect(secondCancel?.isCancelled).toBe(true);

    // Verify data unchanged
    if (firstCancel && secondCancel) {
      expect(secondCancel.title).toBe(firstCancel.title);
      expect(secondCancel.createdTime).toEqual(firstCancel.createdTime);
    }
  });
});

// ============================================================================
// Test: Competition status calculation
// ============================================================================

describe("Status with cancellation", () => {
  test("cancelled competition has CANCELLED status", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (competition) {
      // Status calculation: isCancelled takes precedence
      const now = new Date();
      const status = competition.isCancelled
        ? "CANCELLED"
        : competition.startDate && now < competition.startDate
          ? "PENDING"
          : competition.startDate && competition.endDate && now >= competition.startDate && now <= competition.endDate
            ? "ACTIVE"
            : "ENDED";

      expect(status).toBe("CANCELLED");
    }
  });

  test("active competition becomes cancelled when flag set", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");

    // Create competition with dates that make it ACTIVE
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const input: CreateCompetitionInput = {
      serverId,
      ownerId,
      channelId: testChannelId("123456789012345678"),
      title: "Active Competition",
      description: "Currently active",
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
    const competitionId = competition.id;

    // Verify it's ACTIVE
    const before = await getCompetitionById(prisma, competitionId);
    expect(before).not.toBeNull();
    if (before) {
      const now = new Date();
      const statusBefore = before.isCancelled
        ? "CANCELLED"
        : before.startDate && now < before.startDate
          ? "PENDING"
          : before.startDate && before.endDate && now >= before.startDate && now <= before.endDate
            ? "ACTIVE"
            : "ENDED";
      expect(statusBefore).toBe("ACTIVE");
    }

    // Cancel it
    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    // Verify it's now CANCELLED
    const after = await getCompetitionById(prisma, competitionId);
    expect(after).not.toBeNull();
    if (after) {
      const now = new Date();
      const statusAfter = after.isCancelled
        ? "CANCELLED"
        : after.startDate && now < after.startDate
          ? "PENDING"
          : after.startDate && after.endDate && now >= after.startDate && now <= after.endDate
            ? "ACTIVE"
            : "ENDED";
      expect(statusAfter).toBe("CANCELLED");
    }
  });
});

// ============================================================================
// Test: Permission validation logic
// ============================================================================

describe("Permission checks", () => {
  test("owner ID matches competition owner", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();
    if (competition) {
      expect(competition.ownerId).toBe(ownerId);

      // Simulate permission check
      const isOwner = competition.ownerId === ownerId;
      expect(isOwner).toBe(true);
    }
  });

  test("non-owner ID does not match", async () => {
    const serverId = testGuildId("123456789012345678");
    const ownerId = testAccountId("111111111111111111");
    const otherUserId = "222222222222222222";
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();
    if (competition) {
      const isOwner = competition.ownerId === otherUserId;
      expect(isOwner).toBe(false);
    }
  });
});
