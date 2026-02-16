import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createCompetition } from "@scout-for-lol/backend/database/competition/queries.ts";
import type { CreateCompetitionInput } from "@scout-for-lol/backend/database/competition/queries.ts";
import {
  addParticipant,
  getParticipantStatus,
  removeParticipant,
} from "@scout-for-lol/backend/database/competition/participants.ts";
import { testGuildId, testAccountId, testChannelId } from "@scout-for-lol/backend/testing/test-ids.ts";
import {
  type DiscordAccountId,
  type DiscordGuildId,
  type PlayerId,
  type CompetitionId,
  type DiscordChannelId,
} from "@scout-for-lol/data";
import { createTestDatabase, deleteIfExists } from "@scout-for-lol/backend/testing/test-database.ts";

// Create a test database for integration tests
const { prisma } = createTestDatabase("competition-leave-test");

beforeEach(async () => {
  // Clean up database before each test
  await deleteIfExists(() => prisma.competitionSnapshot.deleteMany());
  await deleteIfExists(() => prisma.competitionParticipant.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
  await deleteIfExists(() => prisma.subscription.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
});
afterAll(async () => {
  await prisma.$disconnect();
});

// ============================================================================
// Test Helpers
// ============================================================================

async function createTestPlayer(
  serverId: DiscordGuildId,
  discordId: DiscordAccountId,
  alias: string,
): Promise<{ playerId: PlayerId }> {
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias,
      discordId,
      serverId,
      creatorDiscordId: discordId,
      createdTime: now,
      updatedTime: now,
    },
  });

  return { playerId: player.id };
}

async function createTestCompetition(
  serverId: DiscordGuildId,
  ownerId: DiscordAccountId,
  options?: {
    visibility?: "OPEN" | "INVITE_ONLY" | "SERVER_WIDE";
    maxParticipants?: number;
    isCancelled?: boolean;
    startDate?: Date;
    endDate?: Date;
  },
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
    visibility: options?.visibility ?? "OPEN",
    maxParticipants: options?.maxParticipants ?? 50,
    dates: {
      type: "FIXED_DATES",
      startDate: options?.startDate ?? tomorrow,
      endDate: options?.endDate ?? nextWeek,
    },
    criteria: {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    },
  };

  const competition = await createCompetition(prisma, input);

  // If cancelled, update it
  if (options?.isCancelled) {
    await prisma.competition.update({
      where: { id: competition.id },
      data: { isCancelled: true },
    });
  }

  return { competitionId: competition.id, channelId: competition.channelId };
}

// ============================================================================
// Integration Tests - Leave Competition
// ============================================================================

describe("Competition Leave - Integration Tests", () => {
  const serverId = testGuildId("12300");
  const ownerId = testAccountId("123000");
  const user1Id = testAccountId("100000000010");
  const user2Id = testAccountId("200000000020");

  // ==========================================================================
  // Test 1: Leave joined competition
  // ==========================================================================

  test("User can leave a competition they joined", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, testAccountId("100000000010"), "Player1");
    const { competitionId } = await createTestCompetition(serverId, ownerId, { visibility: "OPEN" });

    // Join competition
    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });

    // Verify joined
    const statusBeforeLeave = await getParticipantStatus(prisma, competitionId, player1Id);
    expect(statusBeforeLeave).toBe("JOINED");

    // Act - Leave competition
    const result = await removeParticipant(prisma, competitionId, player1Id);

    // Assert
    expect(result.status).toBe("LEFT");
    expect(result.leftAt).not.toBeNull();
    expect(result.joinedAt).not.toBeNull(); // Should preserve joinedAt

    // Verify status updated
    const statusAfterLeave = await getParticipantStatus(prisma, competitionId, player1Id);
    expect(statusAfterLeave).toBe("LEFT");
  });

  // ==========================================================================
  // Test 2: Leave invited competition (decline invitation)
  // ==========================================================================

  test("User can leave a competition they were invited to (decline invitation)", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, testAccountId("100000000010"), "Player1");
    const { competitionId } = await createTestCompetition(serverId, ownerId, { visibility: "INVITE_ONLY" });

    // Add as invited
    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: player1Id,
      status: "INVITED",
      invitedBy: ownerId,
    });

    // Verify invited
    const statusBeforeLeave = await getParticipantStatus(prisma, competitionId, player1Id);
    expect(statusBeforeLeave).toBe("INVITED");

    // Act - Leave (decline invitation)
    const result = await removeParticipant(prisma, competitionId, player1Id);

    // Assert
    expect(result.status).toBe("LEFT");
    expect(result.leftAt).not.toBeNull();
    expect(result.invitedAt).not.toBeNull(); // Should preserve invitedAt
    expect(result.joinedAt).toBeNull(); // Should not have joinedAt since never joined

    // Verify status updated
    const statusAfterLeave = await getParticipantStatus(prisma, competitionId, player1Id);
    expect(statusAfterLeave).toBe("LEFT");
  });

  // ==========================================================================
  // Test 3: Leave non-participant competition (error)
  // ==========================================================================

  test("User cannot leave a competition they are not part of", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, testAccountId("100000000010"), "Player1");
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    // User is not a participant

    // Act & Assert
    expect(async () => {
      await removeParticipant(prisma, competitionId, player1Id);
    }).toThrow();
  });

  // ==========================================================================
  // Test 4: Leave already left competition (error)
  // ==========================================================================

  test("User cannot leave a competition they already left", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, testAccountId("100000000010"), "Player1");
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    // Join and then leave
    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });
    await removeParticipant(prisma, competitionId, player1Id);

    // Verify already left
    const status = await getParticipantStatus(prisma, competitionId, player1Id);
    expect(status).toBe("LEFT");

    // Act & Assert - Try to leave again
    expect(async () => {
      await removeParticipant(prisma, competitionId, player1Id);
    }).toThrow("Participant has already left the competition");
  });

  // ==========================================================================
  // Test 5: Cannot rejoin after leaving
  // ==========================================================================

  test("User cannot rejoin a competition after leaving", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, testAccountId("100000000010"), "Player1");
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    // Join, leave, then try to rejoin
    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });
    await removeParticipant(prisma, competitionId, player1Id);

    // Act & Assert - Try to rejoin
    expect(async () => {
      await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });
    }).toThrow("Cannot rejoin a competition after leaving");
  });

  // ==========================================================================
  // Test 6: Leave completed competition (allowed)
  // ==========================================================================

  test("User can leave a completed/ended competition", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, user1Id, "Player1");

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    // Create competition that is active NOW (started yesterday, ends next week)
    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      startDate: yesterday,
      endDate: nextWeek,
    });

    // Join competition while it's active
    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });

    // Now simulate competition ending by updating the end date to the past
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    await prisma.competition.update({
      where: { id: competitionId },
      data: { endDate: twoDaysAgo },
    });

    // Act - Leave ended competition (should succeed)
    const result = await removeParticipant(prisma, competitionId, player1Id);

    // Assert
    expect(result.status).toBe("LEFT");
    expect(result.leftAt).not.toBeNull();

    // Verify status
    const status = await getParticipantStatus(prisma, competitionId, player1Id);
    expect(status).toBe("LEFT");
  });

  // ==========================================================================
  // Test 7: Leave cancelled competition (allowed)
  // ==========================================================================

  test("User can leave a cancelled competition", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, testAccountId("100000000010"), "Player1");

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // Create active competition (started yesterday so it's active now)
    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      startDate: yesterday,
    });

    // Join competition while it's active
    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });

    // Now cancel the competition
    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    // Act - Leave cancelled competition (should still succeed)
    const result = await removeParticipant(prisma, competitionId, player1Id);

    // Assert
    expect(result.status).toBe("LEFT");
    expect(result.leftAt).not.toBeNull();
  });

  // ==========================================================================
  // Test 8: Leave preserves historical data
  // ==========================================================================

  test("Leaving competition preserves joinedAt and invitedAt timestamps", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, user1Id, "Player1");
    const { competitionId } = await createTestCompetition(serverId, ownerId, { visibility: "INVITE_ONLY" });

    // Add as invited
    const invitedParticipant = await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: player1Id,
      status: "INVITED",
      invitedBy: ownerId,
    });
    const invitedAt = invitedParticipant.invitedAt;

    // Accept invitation (transition to JOINED)
    const joinedParticipant = await prisma.competitionParticipant.update({
      where: {
        competitionId_playerId: { competitionId, playerId: player1Id },
      },
      data: {
        status: "JOINED",
        joinedAt: new Date(),
      },
    });
    const joinedAt = joinedParticipant.joinedAt;

    // Act - Leave competition
    const leftParticipant = await removeParticipant(prisma, competitionId, player1Id);

    // Assert - All timestamps should be preserved
    expect(leftParticipant.status).toBe("LEFT");
    expect(leftParticipant.invitedAt?.getTime()).toBe(invitedAt?.getTime());
    expect(leftParticipant.joinedAt?.getTime()).toBe(joinedAt?.getTime());
    expect(leftParticipant.leftAt).not.toBeNull();
  });

  // ==========================================================================
  // Test 9: Multiple users can leave independently
  // ==========================================================================

  test("Multiple users can leave the same competition independently", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, user1Id, "Player1");
    const { playerId: player2Id } = await createTestPlayer(serverId, user2Id, "Player2");
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    // Both join
    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });
    await addParticipant({ prisma, competitionId: competitionId, playerId: player2Id, status: "JOINED" });

    // Act - Player 1 leaves
    await removeParticipant(prisma, competitionId, player1Id);

    // Assert - Player 1 left, Player 2 still joined
    const player1Status = await getParticipantStatus(prisma, competitionId, player1Id);
    const player2Status = await getParticipantStatus(prisma, competitionId, player2Id);

    expect(player1Status).toBe("LEFT");
    expect(player2Status).toBe("JOINED");

    // Player 2 can still leave
    await removeParticipant(prisma, competitionId, player2Id);
    const player2StatusAfter = await getParticipantStatus(prisma, competitionId, player2Id);
    expect(player2StatusAfter).toBe("LEFT");
  });

  // ==========================================================================
  // Test 10: Leave updates participant count
  // ==========================================================================

  test("Leaving competition reduces active participant count", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, user1Id, "Player1");
    const { playerId: player2Id } = await createTestPlayer(serverId, user2Id, "Player2");
    const { competitionId } = await createTestCompetition(serverId, ownerId);

    // Both join
    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });
    await addParticipant({ prisma, competitionId: competitionId, playerId: player2Id, status: "JOINED" });

    // Verify count
    const countBefore = await prisma.competitionParticipant.count({
      where: { competitionId, status: { not: "LEFT" } },
    });
    expect(countBefore).toBe(2);

    // Act - Player 1 leaves
    await removeParticipant(prisma, competitionId, player1Id);

    // Assert - Count decreased
    const countAfter = await prisma.competitionParticipant.count({
      where: { competitionId, status: { not: "LEFT" } },
    });
    expect(countAfter).toBe(1);
  });

  // ==========================================================================
  // Test 11: Leave competition with non-existent competition ID (error)
  // ==========================================================================

  test("Cannot leave a competition that doesn't exist", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, user1Id, "Player1");
    const nonExistentCompetitionId = 99999;

    // Act & Assert
    expect(async () => {
      await removeParticipant(prisma, nonExistentCompetitionId, player1Id);
    }).toThrow();
  });

  // ==========================================================================
  // Test 12: After leaving, competition can accept new participants
  // ==========================================================================

  test("After user leaves, another user can take their spot (if at max)", async () => {
    // Arrange
    const { playerId: player1Id } = await createTestPlayer(serverId, user1Id, "Player1");
    const { playerId: player2Id } = await createTestPlayer(serverId, user2Id, "Player2");
    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      maxParticipants: 1, // Only 1 participant allowed
    });

    // Player 1 joins (fills the spot)
    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });

    // Player 2 cannot join (full)
    expect(async () => {
      await addParticipant({ prisma, competitionId: competitionId, playerId: player2Id, status: "JOINED" });
    }).toThrow("Competition has reached maximum participants");

    // Act - Player 1 leaves
    await removeParticipant(prisma, competitionId, player1Id);

    // Assert - Player 2 can now join
    await addParticipant({ prisma, competitionId: competitionId, playerId: player2Id, status: "JOINED" });
    const player2Status = await getParticipantStatus(prisma, competitionId, player2Id);
    expect(player2Status).toBe("JOINED");

    // Verify counts
    const activeCount = await prisma.competitionParticipant.count({
      where: { competitionId, status: { not: "LEFT" } },
    });
    expect(activeCount).toBe(1); // Only Player 2 is active
  });
});
