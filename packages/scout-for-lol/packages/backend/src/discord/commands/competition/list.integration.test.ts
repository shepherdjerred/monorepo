import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { type DiscordAccountId, type DiscordChannelId, type DiscordGuildId } from "@scout-for-lol/data";
import { createCompetition, getCompetitionsByServer } from "@scout-for-lol/backend/database/competition/queries.ts";
import type { CreateCompetitionInput } from "@scout-for-lol/backend/database/competition/queries.ts";
import { testGuildId, testAccountId, testChannelId } from "@scout-for-lol/backend/testing/test-ids.ts";
import { createTestDatabase, deleteIfExists } from "@scout-for-lol/backend/testing/test-database.ts";

// Create a test database for integration tests
const { prisma } = createTestDatabase("competition-list-test");

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

/** Returns a date N days from now (positive = future, negative = past) */
function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/** Active date range: starts today, ends in 30 days */
function activeDateRange(): { startDate: Date; endDate: Date } {
  return { startDate: daysFromNow(0), endDate: daysFromNow(30) };
}

/** Ended date range: started 60 days ago, ended 30 days ago */
function endedDateRange(): { startDate: Date; endDate: Date } {
  return { startDate: daysFromNow(-60), endDate: daysFromNow(-30) };
}

function createTestCompetitionInput(
  serverId: DiscordGuildId,
  ownerId: DiscordAccountId,
  channelId: DiscordChannelId,
  overrides?: Partial<CreateCompetitionInput>,
): CreateCompetitionInput {
  return {
    serverId,
    ownerId,
    channelId,
    title: "Test Competition",
    description: "Test description",
    visibility: "OPEN",
    maxParticipants: 50,
    dates: {
      type: "FIXED_DATES",
      ...activeDateRange(),
    },
    criteria: {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("Competition List Query", () => {
  const serverId = testGuildId("12300");
  const ownerId1 = testAccountId("100000000010");
  const ownerId2 = testAccountId("200000000020");
  const channelId = testChannelId("1000000001");

  test("empty list when no competitions exist", async () => {
    const competitions = await getCompetitionsByServer(prisma, serverId);
    expect(competitions).toEqual([]);
  });

  test("returns all competitions for a server", async () => {
    // Create multiple competitions
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId1, channelId, { title: "Competition 1" }),
    );
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId1, channelId, { title: "Competition 2" }),
    );
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId2, channelId, { title: "Competition 3" }),
    );

    // Create competition in different server (should not appear)
    await createCompetition(
      prisma,
      createTestCompetitionInput(testGuildId("00000"), ownerId1, channelId, {
        title: "Other Server Comp",
      }),
    );

    const competitions = await getCompetitionsByServer(prisma, serverId);
    expect(competitions).toHaveLength(3);
    expect(competitions.map((c) => c.title).sort()).toEqual(["Competition 1", "Competition 2", "Competition 3"]);
  });

  test("filters by ownerId", async () => {
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId1, channelId, { title: "Owner 1 Comp" }),
    );
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId2, channelId, { title: "Owner 2 Comp" }),
    );

    const owner1Comps = await getCompetitionsByServer(prisma, serverId, { ownerId: ownerId1 });
    expect(owner1Comps).toHaveLength(1);
    expect(owner1Comps[0]?.title).toBe("Owner 1 Comp");

    const owner2Comps = await getCompetitionsByServer(prisma, serverId, { ownerId: ownerId2 });
    expect(owner2Comps).toHaveLength(1);
    expect(owner2Comps[0]?.title).toBe("Owner 2 Comp");
  });

  test("filters by activeOnly - excludes cancelled", async () => {
    // Create active competition
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId1, channelId, { title: "Active Comp" }),
    );

    // Create and cancel competition
    const cancelled = await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId1, channelId, { title: "Cancelled Comp" }),
    );
    await prisma.competition.update({
      where: { id: cancelled.id },
      data: { isCancelled: true },
    });

    // Get all competitions
    const allComps = await getCompetitionsByServer(prisma, serverId);
    expect(allComps).toHaveLength(2);

    // Get only active competitions
    const activeComps = await getCompetitionsByServer(prisma, serverId, { activeOnly: true });
    expect(activeComps).toHaveLength(1);
    expect(activeComps[0]?.title).toBe("Active Comp");
  });

  test("filters by activeOnly - excludes ended competitions", async () => {
    // Create ongoing competition
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId1, channelId, {
        title: "Ongoing Comp",
        dates: {
          type: "FIXED_DATES",
          ...activeDateRange(),
        },
      }),
    );

    // Create ended competition
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId1, channelId, {
        title: "Ended Comp",
        dates: {
          type: "FIXED_DATES",
          ...endedDateRange(),
        },
      }),
    );

    // Get all competitions
    const allComps = await getCompetitionsByServer(prisma, serverId);
    expect(allComps).toHaveLength(2);

    // Get only active competitions
    const activeComps = await getCompetitionsByServer(prisma, serverId, { activeOnly: true });
    expect(activeComps).toHaveLength(1);
    expect(activeComps[0]?.title).toBe("Ongoing Comp");
  });

  test("activeOnly includes season-based competitions", async () => {
    // Create season-based competition (no end date)
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId1, channelId, {
        title: "Season Comp",
        dates: {
          type: "SEASON",
          seasonId: "2025_SEASON_3_ACT_1",
        },
      }),
    );

    const activeComps = await getCompetitionsByServer(prisma, serverId, { activeOnly: true });
    expect(activeComps).toHaveLength(1);
    expect(activeComps[0]?.title).toBe("Season Comp");
  });

  test("returns competitions ordered by creation time (newest first)", async () => {
    // Create competitions with slight delays to ensure ordering
    await createCompetition(prisma, createTestCompetitionInput(serverId, ownerId1, channelId, { title: "First" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    await createCompetition(prisma, createTestCompetitionInput(serverId, ownerId1, channelId, { title: "Second" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    await createCompetition(prisma, createTestCompetitionInput(serverId, ownerId1, channelId, { title: "Third" }));

    const competitions = await getCompetitionsByServer(prisma, serverId);
    expect(competitions.map((c) => c.title)).toEqual(["Third", "Second", "First"]);
  });

  test("combines activeOnly and ownerId filters", async () => {
    // Create active competition by owner1
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId1, channelId, {
        title: "Owner1 Active",
        dates: {
          type: "FIXED_DATES",
          ...activeDateRange(),
        },
      }),
    );

    // Create ended competition by owner1
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId1, channelId, {
        title: "Owner1 Ended",
        dates: {
          type: "FIXED_DATES",
          ...endedDateRange(),
        },
      }),
    );

    // Create active competition by owner2
    await createCompetition(
      prisma,
      createTestCompetitionInput(serverId, ownerId2, channelId, {
        title: "Owner2 Active",
        dates: {
          type: "FIXED_DATES",
          ...activeDateRange(),
        },
      }),
    );

    const filtered = await getCompetitionsByServer(prisma, serverId, {
      activeOnly: true,
      ownerId: ownerId1,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe("Owner1 Active");
  });

  test("handles large number of competitions", async () => {
    // Create 20 competitions
    for (let i = 0; i < 20; i++) {
      await createCompetition(
        prisma,
        createTestCompetitionInput(serverId, ownerId1, channelId, { title: `Competition ${i.toString()}` }),
      );
    }

    const competitions = await getCompetitionsByServer(prisma, serverId);
    expect(competitions).toHaveLength(20);
  });
});
