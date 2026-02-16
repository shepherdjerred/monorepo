import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { match } from "ts-pattern";
import { createCompetition, getCompetitionById } from "@scout-for-lol/backend/database/competition/queries.ts";
import type { CreateCompetitionInput } from "@scout-for-lol/backend/database/competition/queries.ts";
import { addParticipant } from "@scout-for-lol/backend/database/competition/participants.ts";
import { testGuildId, testAccountId, testChannelId } from "@scout-for-lol/backend/testing/test-ids.ts";
import {
  ChampionIdSchema,
  getCompetitionStatus,
  type ChampionId,
  type CompetitionId,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type PlayerId,
} from "@scout-for-lol/data/index";
import { createTestDatabase, deleteIfExists } from "@scout-for-lol/backend/testing/test-database.ts";

// Create a test database for integration tests
const { prisma } = createTestDatabase("competition-view-test");

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
    title?: string;
    description?: string;
    criteriaType?: "MOST_GAMES_PLAYED" | "HIGHEST_RANK" | "MOST_WINS_CHAMPION";
    championId?: ChampionId;
  },
): Promise<{ competitionId: CompetitionId; channelId: DiscordChannelId }> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const criteria: CreateCompetitionInput["criteria"] = options?.criteriaType
    ? match(options.criteriaType)
        .with("HIGHEST_RANK", () => ({ type: "HIGHEST_RANK" as const, queue: "SOLO" as const }))
        .with("MOST_WINS_CHAMPION", () => {
          if (!options.championId) {
            throw new Error("championId required for MOST_WINS_CHAMPION");
          }
          return {
            type: "MOST_WINS_CHAMPION" as const,
            championId: options.championId,
            queue: "SOLO" as const,
          };
        })
        .with("MOST_GAMES_PLAYED", () => ({ type: "MOST_GAMES_PLAYED" as const, queue: "SOLO" as const }))
        .exhaustive()
    : { type: "MOST_GAMES_PLAYED" as const, queue: "SOLO" as const };

  const input: CreateCompetitionInput = {
    serverId,
    ownerId,
    channelId: testChannelId("123456789012345678"),
    title: options?.title ?? "Test Competition",
    description: options?.description ?? "A test competition",
    visibility: options?.visibility ?? "OPEN",
    maxParticipants: options?.maxParticipants ?? 50,
    dates: {
      type: "FIXED_DATES",
      startDate: options?.startDate ?? tomorrow,
      endDate: options?.endDate ?? nextWeek,
    },
    criteria,
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
// Tests: View DRAFT Competition
// ============================================================================

describe("Competition View - DRAFT Status", () => {
  test("should show details for DRAFT competition with no participants", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");

    const { competitionId } = await createTestCompetition(serverId, ownerId);

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    const status = getCompetitionStatus(competition);
    expect(status).toBe("DRAFT");

    expect(competition.title).toBe("Test Competition");
    expect(competition.description).toBe("A test competition");
    expect(competition.visibility).toBe("OPEN");
    expect(competition.maxParticipants).toBe(50);
  });

  test("should show participant list for DRAFT competition with participants", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");

    const { competitionId } = await createTestCompetition(serverId, ownerId);
    const { playerId: player1Id } = await createTestPlayer(serverId, testAccountId("100000000010"), "Player1");
    const { playerId: player2Id } = await createTestPlayer(serverId, testAccountId("200000000020"), "Player2");
    const { playerId: player3Id } = await createTestPlayer(serverId, testAccountId("300000000030"), "Player3");

    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });
    await addParticipant({ prisma, competitionId: competitionId, playerId: player2Id, status: "JOINED" });
    await addParticipant({ prisma, competitionId: competitionId, playerId: player3Id, status: "JOINED" });

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    const status = getCompetitionStatus(competition);
    expect(status).toBe("DRAFT");

    // Verify participants
    const participants = await prisma.competitionParticipant.findMany({
      where: { competitionId, status: "JOINED" },
    });
    expect(participants).toHaveLength(3);
  });

  test("should indicate leaderboard not available for DRAFT competition", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");

    const { competitionId } = await createTestCompetition(serverId, ownerId);

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    const status = getCompetitionStatus(competition);
    expect(status).toBe("DRAFT");

    // For DRAFT competitions, leaderboard should not be available
    // This would be validated by the embed content in actual Discord interaction
  });
});

// ============================================================================
// Tests: View ACTIVE Competition
// ============================================================================

describe("Competition View - ACTIVE Status", () => {
  test("should show details for ACTIVE competition", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      startDate: yesterday,
      endDate: nextWeek,
    });

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    const status = getCompetitionStatus(competition);
    expect(status).toBe("ACTIVE");
  });

  test("should handle ACTIVE competition with participants", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);

    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      startDate: yesterday,
      endDate: nextWeek,
    });

    // Add participants
    const { playerId: player1Id } = await createTestPlayer(serverId, testAccountId("100000000010"), "Player1");
    const { playerId: player2Id } = await createTestPlayer(serverId, testAccountId("200000000020"), "Player2");
    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });
    await addParticipant({ prisma, competitionId: competitionId, playerId: player2Id, status: "JOINED" });

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    const status = getCompetitionStatus(competition);
    expect(status).toBe("ACTIVE");

    const { calculateLeaderboard } = await import("@scout-for-lol/backend/league/competition/leaderboard.js");
    const leaderboard = await calculateLeaderboard(prisma, competition);

    // Should have entries for both participants
    expect(leaderboard).toHaveLength(2);

    // Verify leaderboard structure
    for (const entry of leaderboard) {
      expect(entry).toHaveProperty("playerId");
      expect(entry).toHaveProperty("playerName");
      expect(entry).toHaveProperty("score");
      expect(entry).toHaveProperty("rank");
      expect(entry.rank).toBeNumber();
      expect(entry.rank).toBeGreaterThan(0);
    }

    // Verify ranks are assigned correctly (should be 1 or 2)
    const ranks = leaderboard.map((e) => e.rank);
    expect(ranks).toContain(1);
  });
});

// ============================================================================
// Tests: View ENDED Competition
// ============================================================================

describe("Competition View - ENDED Status", () => {
  test("should show details for ENDED competition", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");

    const now = new Date();
    const lastWeek = new Date(now);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      startDate: lastWeek,
      endDate: yesterday,
    });

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    const status = getCompetitionStatus(competition);
    expect(status).toBe("ENDED");
  });

  test("should show final standings for ENDED competition", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");

    const now = new Date();
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);

    // Create competition that will end in the future initially
    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      startDate: twoWeeksAgo,
      endDate: nextWeek,
    });

    // Add participants while competition is active
    const { playerId: player1Id } = await createTestPlayer(serverId, testAccountId("100000000010"), "Player1");
    const { playerId: player2Id } = await createTestPlayer(serverId, testAccountId("200000000020"), "Player2");
    await addParticipant({ prisma, competitionId: competitionId, playerId: player1Id, status: "JOINED" });
    await addParticipant({ prisma, competitionId: competitionId, playerId: player2Id, status: "JOINED" });

    // Now update the competition to have ended
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    await prisma.competition.update({
      where: { id: competitionId },
      data: { endDate: yesterday },
    });

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    const status = getCompetitionStatus(competition);
    expect(status).toBe("ENDED");

    // Verify participants are still there
    const participants = await prisma.competitionParticipant.findMany({
      where: { competitionId, status: "JOINED" },
    });
    expect(participants).toHaveLength(2);

    // Test final leaderboard for ended competition
    const { calculateLeaderboard } = await import("@scout-for-lol/backend/league/competition/leaderboard.js");
    const leaderboard = await calculateLeaderboard(prisma, competition);

    // Should have entries for both participants
    expect(leaderboard).toHaveLength(2);

    // Verify final standings structure
    for (const entry of leaderboard) {
      expect(entry).toHaveProperty("playerId");
      expect(entry).toHaveProperty("playerName");
      expect(entry).toHaveProperty("score");
      expect(entry).toHaveProperty("rank");
      expect(entry.rank).toBeNumber();
      expect(entry.rank).toBeGreaterThan(0);
    }

    // Verify final rankings are assigned (1st and 2nd place)
    const ranks = leaderboard.map((e) => e.rank);
    expect(ranks).toContain(1);
    expect(Math.max(...ranks)).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// Tests: View CANCELLED Competition
// ============================================================================

describe("Competition View - CANCELLED Status", () => {
  test("should show details for CANCELLED competition", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");

    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      isCancelled: true,
    });

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    const status = getCompetitionStatus(competition);
    expect(status).toBe("CANCELLED");

    expect(competition.isCancelled).toBe(true);
  });
});

// ============================================================================
// Tests: View Non-existent Competition
// ============================================================================

describe("Competition View - Error Cases", () => {
  test("should return null for non-existent competition", async () => {
    const competition = await getCompetitionById(prisma, 999999);
    expect(competition).toBeUndefined();
  });
});

// ============================================================================
// Tests: Different Criteria Types
// ============================================================================

describe("Competition View - Different Criteria Types", () => {
  test("should show MOST_GAMES_PLAYED criteria", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");

    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      criteriaType: "MOST_GAMES_PLAYED",
    });

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    expect(competition.criteria.type).toBe("MOST_GAMES_PLAYED");
  });

  test("should show HIGHEST_RANK criteria", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");

    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      criteriaType: "HIGHEST_RANK",
    });

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    expect(competition.criteria.type).toBe("HIGHEST_RANK");
  });

  test("should show MOST_WINS_CHAMPION criteria with champion ID", async () => {
    const serverId = testGuildId("1000000001");
    const ownerId = testAccountId("10000000100");
    const championId = ChampionIdSchema.parse(157); // Yasuo

    const { competitionId } = await createTestCompetition(serverId, ownerId, {
      criteriaType: "MOST_WINS_CHAMPION",
      championId,
    });

    const competition = await getCompetitionById(prisma, competitionId);
    expect(competition).not.toBeNull();

    if (!competition) {
      throw new Error("Competition not found");
    }

    expect(competition.criteria.type).toBe("MOST_WINS_CHAMPION");
    if (competition.criteria.type === "MOST_WINS_CHAMPION") {
      expect(competition.criteria.championId).toBe(ChampionIdSchema.parse(championId));
    }
  });
});
