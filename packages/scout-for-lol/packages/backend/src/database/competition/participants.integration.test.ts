import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  acceptInvitation,
  addParticipant,
  canJoinCompetition,
  getParticipantStatus,
  getParticipants,
  removeParticipant,
} from "@scout-for-lol/backend/database/competition/participants.ts";
import {
  createCompetition,
  type CreateCompetitionInput,
} from "@scout-for-lol/backend/database/competition/queries.ts";
import { ErrorSchema } from "@scout-for-lol/backend/utils/errors.ts";
import type {
  CompetitionId,
  DiscordAccountId,
  PlayerId,
} from "@scout-for-lol/data";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import {
  testGuildId,
  testAccountId,
  testChannelId,
} from "@scout-for-lol/backend/testing/test-ids.ts";
import {
  createTestDatabase,
  deleteIfExists,
} from "@scout-for-lol/backend/testing/test-database.ts";

// Create a test database
const { prisma } = createTestDatabase("participants-test");

// Test helpers
async function createTestCompetition(
  maxParticipants = 50,
): Promise<{ competitionId: CompetitionId }> {
  const now = new Date();
  const input: CreateCompetitionInput = {
    serverId: testGuildId("123456789012345678"),
    ownerId: testAccountId("987654321098765432"),
    channelId: testChannelId("111222333444555666"),
    title: "Test Competition",
    description: "Test",
    visibility: "OPEN",
    maxParticipants,
    dates: {
      type: "FIXED_DATES",
      startDate: now,
      endDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    },
    criteria: {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    },
  };

  const competition = await createCompetition(prisma, input);
  return { competitionId: competition.id };
}

async function createTestPlayer(
  alias: string,
  discordId: DiscordAccountId,
): Promise<{ playerId: PlayerId }> {
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias,
      discordId,
      serverId: testGuildId("123456789012345678"),
      creatorDiscordId: testAccountId("987654321098765432"),
      createdTime: now,
      updatedTime: now,
    },
  });
  return { playerId: player.id };
}

beforeEach(async () => {
  // Clean up before each test
  await deleteIfExists(() => prisma.competitionParticipant.deleteMany());
  await deleteIfExists(() => prisma.competition.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
});
afterAll(async () => {
  await prisma.$disconnect();
});

// ============================================================================
// addParticipant - JOINED status
// ============================================================================

describe("addParticipant - JOINED status", () => {
  test("adds participant with JOINED status successfully", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    const participant = await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });

    expect(participant.competitionId).toBe(competitionId);
    expect(participant.playerId).toBe(playerId);
    expect(participant.status).toBe("JOINED");
    expect(participant.joinedAt).toBeInstanceOf(Date);
    expect(participant.invitedAt).toBeNull();
    expect(participant.invitedBy).toBeNull();
    expect(participant.leftAt).toBeNull();
  });

  test("sets joinedAt timestamp", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    const before = new Date();
    const participant = await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });
    const after = new Date();

    expect(participant.joinedAt).not.toBeNull();
    if (participant.joinedAt) {
      expect(participant.joinedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(participant.joinedAt.getTime()).toBeLessThanOrEqual(
        after.getTime(),
      );
    }
  });
});

// ============================================================================
// addParticipant - INVITED status
// ============================================================================

describe("addParticipant - INVITED status", () => {
  test("adds participant with INVITED status successfully", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );
    const inviterId = testAccountId("222222222222222222");

    const participant = await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "INVITED",
      invitedBy: inviterId,
    });

    expect(participant.status).toBe("INVITED");
    expect(participant.invitedAt).toBeInstanceOf(Date);
    expect(participant.invitedBy).toBe(inviterId);
    expect(participant.joinedAt).toBeNull();
    expect(participant.leftAt).toBeNull();
  });

  test("can transition from INVITED to JOINED", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId,
      playerId,
      status: "INVITED",
      invitedBy: testAccountId("222222222222222222"),
    });

    const updated = await acceptInvitation(prisma, competitionId, playerId);

    expect(updated.status).toBe("JOINED");
    expect(updated.joinedAt).toBeInstanceOf(Date);
    expect(updated.invitedAt).toBeInstanceOf(Date); // Preserved
    expect(updated.invitedBy).toBe(testAccountId("222222222222222222")); // Preserved
  });
});

// ============================================================================
// addParticipant - duplicate prevention
// ============================================================================

describe("addParticipant - duplicate prevention", () => {
  test("throws error when adding same participant twice", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });

    let error: unknown = null;
    try {
      await addParticipant({
        prisma,
        competitionId: competitionId,
        playerId: playerId,
        status: "JOINED",
      });
    } catch (e) {
      error = e;
    }

    expect(error).not.toBeNull();
    const errorResult = ErrorSchema.safeParse(error);
    if (errorResult.success) {
      expect(errorResult.data.message).toContain("already a participant");
    }
  });

  test("throws error when player has already left", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });
    await removeParticipant(prisma, competitionId, playerId);

    let error: unknown = null;
    try {
      await addParticipant({
        prisma,
        competitionId: competitionId,
        playerId: playerId,
        status: "JOINED",
      });
    } catch (e) {
      error = e;
    }

    expect(error).not.toBeNull();
    const errorResult = ErrorSchema.safeParse(error);
    if (errorResult.success) {
      expect(errorResult.data.message).toContain("Cannot rejoin");
    }
  });
});

// ============================================================================
// addParticipant - max participants
// ============================================================================

describe("addParticipant - max participants", () => {
  test("allows adding up to maxParticipants", async () => {
    const { competitionId } = await createTestCompetition(3);

    const discordIds = [
      "111111111111111111",
      "111111111111111112",
      "111111111111111113",
    ];
    for (let i = 0; i < 3; i++) {
      const { playerId } = await createTestPlayer(
        `Player${i.toString()}`,
        DiscordAccountIdSchema.parse(discordIds[i] ?? "111111111111111111"),
      );
      await addParticipant({
        prisma,
        competitionId: competitionId,
        playerId: playerId,
        status: "JOINED",
      });
    }

    const participants = await getParticipants(prisma, competitionId);
    expect(participants).toHaveLength(3);
  });

  test("throws error when exceeding maxParticipants", async () => {
    const { competitionId } = await createTestCompetition(3);

    const discordIds = [
      "111111111111111111",
      "111111111111111112",
      "111111111111111113",
    ];
    for (let i = 0; i < 3; i++) {
      const { playerId } = await createTestPlayer(
        `Player${i.toString()}`,
        DiscordAccountIdSchema.parse(discordIds[i] ?? "111111111111111111"),
      );
      await addParticipant({
        prisma,
        competitionId: competitionId,
        playerId: playerId,
        status: "JOINED",
      });
    }

    const { playerId } = await createTestPlayer(
      "Player4",
      testAccountId("444444444444444444"),
    );

    let error: unknown = null;
    try {
      await addParticipant({
        prisma,
        competitionId: competitionId,
        playerId: playerId,
        status: "JOINED",
      });
    } catch (e) {
      error = e;
    }

    expect(error).not.toBeNull();
    const errorResult = ErrorSchema.safeParse(error);
    if (errorResult.success) {
      expect(errorResult.data.message).toContain("maximum participants");
    }
  });

  test("LEFT participants don't count towards limit", async () => {
    const { competitionId } = await createTestCompetition(2);

    // Add 2 participants
    const { playerId: p1 } = await createTestPlayer(
      "Player1",
      testAccountId("111111111111111111"),
    );
    const { playerId: p2 } = await createTestPlayer(
      "Player2",
      testAccountId("222222222222222222"),
    );
    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: p1,
      status: "JOINED",
    });
    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: p2,
      status: "JOINED",
    });

    // One leaves
    await removeParticipant(prisma, competitionId, p1);

    // Should be able to add a new participant
    const { playerId: p3 } = await createTestPlayer(
      "Player3",
      testAccountId("333333333333333333"),
    );
    const participant = await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: p3,
      status: "JOINED",
    });

    expect(participant.status).toBe("JOINED");
  });
});

// ============================================================================
// removeParticipant
// ============================================================================

describe("removeParticipant", () => {
  test("changes status to LEFT and sets leftAt", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });

    const before = new Date();
    const updated = await removeParticipant(prisma, competitionId, playerId);
    const after = new Date();

    expect(updated.status).toBe("LEFT");
    expect(updated.leftAt).toBeInstanceOf(Date);
    if (updated.leftAt) {
      expect(updated.leftAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updated.leftAt.getTime()).toBeLessThanOrEqual(after.getTime());
    }
  });

  test("preserves joinedAt timestamp", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    const added = await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });
    const originalJoinedAt = added.joinedAt;

    const removed = await removeParticipant(prisma, competitionId, playerId);

    expect(removed.joinedAt).toEqual(originalJoinedAt);
  });

  test("throws error for non-existent participant", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    let error: unknown = null;
    try {
      await removeParticipant(prisma, competitionId, playerId);
    } catch (e) {
      error = e;
    }

    expect(error).not.toBeNull();
    const errorResult = ErrorSchema.safeParse(error);
    if (errorResult.success) {
      expect(errorResult.data.message).toContain("not found");
    }
  });

  test("throws error when already left", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });
    await removeParticipant(prisma, competitionId, playerId);

    let error: unknown = null;
    try {
      await removeParticipant(prisma, competitionId, playerId);
    } catch (e) {
      error = e;
    }

    expect(error).not.toBeNull();
    const errorResult = ErrorSchema.safeParse(error);
    if (errorResult.success) {
      expect(errorResult.data.message).toContain("already left");
    }
  });
});

// ============================================================================
// getParticipants - filtering
// ============================================================================

describe("getParticipants - filtering", () => {
  test("returns all participants by default", async () => {
    const { competitionId } = await createTestCompetition();

    const { playerId: p1 } = await createTestPlayer(
      "Player1",
      testAccountId("111111111111111111"),
    );
    const { playerId: p2 } = await createTestPlayer(
      "Player2",
      testAccountId("222222222222222222"),
    );
    const { playerId: p3 } = await createTestPlayer(
      "Player3",
      testAccountId("333333333333333333"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: p1,
      status: "JOINED",
    });
    await addParticipant({
      prisma,
      competitionId,
      playerId: p2,
      status: "INVITED",
      invitedBy: testAccountId("444444444444444444"),
    });
    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: p3,
      status: "JOINED",
    });
    await removeParticipant(prisma, competitionId, p3);

    const all = await getParticipants(prisma, competitionId);

    expect(all).toHaveLength(3);
  });

  test("filters by status=JOINED", async () => {
    const { competitionId } = await createTestCompetition();

    const { playerId: p1 } = await createTestPlayer(
      "Player1",
      testAccountId("111111111111111111"),
    );
    const { playerId: p2 } = await createTestPlayer(
      "Player2",
      testAccountId("222222222222222222"),
    );
    const { playerId: p3 } = await createTestPlayer(
      "Player3",
      testAccountId("333333333333333333"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: p1,
      status: "JOINED",
    });
    await addParticipant({
      prisma,
      competitionId,
      playerId: p2,
      status: "INVITED",
      invitedBy: testAccountId("444444444444444444"),
    });
    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: p3,
      status: "JOINED",
    });

    const joined = await getParticipants(prisma, competitionId, "JOINED");

    expect(joined).toHaveLength(2);
    expect(joined.every((p) => p.status === "JOINED")).toBe(true);
  });

  test("filters by status=INVITED", async () => {
    const { competitionId } = await createTestCompetition();

    const { playerId: p1 } = await createTestPlayer(
      "Player1",
      testAccountId("111111111111111111"),
    );
    const { playerId: p2 } = await createTestPlayer(
      "Player2",
      testAccountId("222222222222222222"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: p1,
      status: "JOINED",
    });
    await addParticipant({
      prisma,
      competitionId,
      playerId: p2,
      status: "INVITED",
      invitedBy: testAccountId("444444444444444444"),
    });

    const invited = await getParticipants(prisma, competitionId, "INVITED");

    expect(invited).toHaveLength(1);
    expect(invited[0]?.status).toBe("INVITED");
  });

  test("returns empty array for empty competition", async () => {
    const { competitionId } = await createTestCompetition();

    const participants = await getParticipants(prisma, competitionId);

    expect(participants).toHaveLength(0);
  });
});

// ============================================================================
// getParticipantStatus
// ============================================================================

describe("getParticipantStatus", () => {
  test("returns JOINED for joined participant", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });

    const status = await getParticipantStatus(prisma, competitionId, playerId);

    expect(status).toBe("JOINED");
  });

  test("returns INVITED for invited participant", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId,
      playerId,
      status: "INVITED",
      invitedBy: testAccountId("222222222222222222"),
    });

    const status = await getParticipantStatus(prisma, competitionId, playerId);

    expect(status).toBe("INVITED");
  });

  test("returns LEFT for participant who left", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });
    await removeParticipant(prisma, competitionId, playerId);

    const status = await getParticipantStatus(prisma, competitionId, playerId);

    expect(status).toBe("LEFT");
  });

  test("returns null for non-participant", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    const status = await getParticipantStatus(prisma, competitionId, playerId);

    expect(status).toBeNull();
  });
});

// ============================================================================
// canJoinCompetition validation
// ============================================================================

describe("canJoinCompetition validation", () => {
  test("returns true for valid join scenario", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    const result = await canJoinCompetition(prisma, competitionId, playerId);

    expect(result.canJoin).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("returns false for cancelled competition", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    // Cancel the competition
    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    const result = await canJoinCompetition(prisma, competitionId, playerId);

    expect(result.canJoin).toBe(false);
    expect(result.reason).toContain("cancelled");
  });

  test("returns false for ended competition", async () => {
    const now = new Date();
    const input: CreateCompetitionInput = {
      serverId: testGuildId("123456789012345678"),
      ownerId: testAccountId("987654321098765432"),
      channelId: testChannelId("111222333444555666"),
      title: "Ended Competition",
      description: "Test",
      visibility: "OPEN",
      maxParticipants: 50,
      dates: {
        type: "FIXED_DATES",
        startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        endDate: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
      criteria: {
        type: "MOST_GAMES_PLAYED",
        queue: "SOLO",
      },
    };

    const competition = await createCompetition(prisma, input);
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    const result = await canJoinCompetition(prisma, competition.id, playerId);

    expect(result.canJoin).toBe(false);
    expect(result.reason).toContain("ended");
  });

  test("returns false when at participant limit", async () => {
    const { competitionId } = await createTestCompetition(2);

    // Fill the competition
    const discordIds = ["111111111111111111", "111111111111111112"];
    for (let i = 0; i < 2; i++) {
      const { playerId } = await createTestPlayer(
        `Player${i.toString()}`,
        DiscordAccountIdSchema.parse(discordIds[i] ?? "111111111111111111"),
      );
      await addParticipant({
        prisma,
        competitionId: competitionId,
        playerId: playerId,
        status: "JOINED",
      });
    }

    const { playerId } = await createTestPlayer(
      "Player3",
      testAccountId("333333333333333333"),
    );

    const result = await canJoinCompetition(prisma, competitionId, playerId);

    expect(result.canJoin).toBe(false);
    expect(result.reason).toContain("maximum participants");
  });

  test("returns false when already joined", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });

    const result = await canJoinCompetition(prisma, competitionId, playerId);

    expect(result.canJoin).toBe(false);
    expect(result.reason).toContain("Already joined");
  });

  test("returns false when already invited", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId,
      playerId,
      status: "INVITED",
      invitedBy: testAccountId("222222222222222222"),
    });

    const result = await canJoinCompetition(prisma, competitionId, playerId);

    expect(result.canJoin).toBe(false);
    expect(result.reason).toContain("invited");
  });

  test("returns false when previously left", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });
    await removeParticipant(prisma, competitionId, playerId);

    const result = await canJoinCompetition(prisma, competitionId, playerId);

    expect(result.canJoin).toBe(false);
    expect(result.reason).toContain("Cannot rejoin");
  });
});

// ============================================================================
// Participant with Player relation
// ============================================================================

describe("Participant with Player relation", () => {
  test("can include Player data when querying participants", async () => {
    const { competitionId } = await createTestCompetition();
    const { playerId } = await createTestPlayer(
      "TestPlayer",
      testAccountId("111111111111111111"),
    );

    await addParticipant({
      prisma,
      competitionId: competitionId,
      playerId: playerId,
      status: "JOINED",
    });

    const participants = await getParticipants(
      prisma,
      competitionId,
      undefined,
      true,
    );

    expect(participants).toHaveLength(1);
    const participant = participants[0];
    if (!participant) {
      throw new Error("Participant not found");
    }

    // Query again with proper typing to get player data
    const withPlayer = await prisma.competitionParticipant.findUnique({
      where: {
        competitionId_playerId: {
          competitionId,
          playerId,
        },
      },
      include: {
        player: true,
      },
    });

    expect(withPlayer).not.toBeNull();
    expect(withPlayer?.player.alias).toBe("TestPlayer");
    expect(withPlayer?.player.discordId).toBe(
      testAccountId("111111111111111111"),
    );
  });
});
