import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createCompetition,
  type CreateCompetitionInput,
} from "@scout-for-lol/backend/database/competition/queries.ts";
import type {
  CompetitionCriteria,
  CompetitionId,
  LeaguePuuid,
  PlayerId,
  Region,
} from "@scout-for-lol/data";
import {
  testGuildId,
  testAccountId,
  testChannelId,
  testPuuid,
} from "@scout-for-lol/backend/testing/test-ids.ts";
import { createTestDatabase } from "@scout-for-lol/backend/testing/test-database.ts";

// Create a test database
const { prisma } = createTestDatabase("lifecycle-test");

// Test helpers
async function createTestCompetition(
  criteria: CompetitionCriteria,
  startDate: Date,
  endDate: Date,
): Promise<{ competitionId: CompetitionId }> {
  const input: CreateCompetitionInput = {
    serverId: testGuildId("123456789012345678"),
    ownerId: testAccountId("987654321098765432"),
    channelId: testChannelId("111222333444555666"),
    title: "Test Competition",
    description: "Test Description",
    visibility: "OPEN",
    maxParticipants: 50,
    dates: {
      type: "FIXED_DATES",
      startDate,
      endDate,
    },
    criteria,
  };

  const competition = await createCompetition(prisma, input);
  return { competitionId: competition.id };
}

async function createTestPlayer(
  alias: string,
  puuid: LeaguePuuid,
  region: Region,
): Promise<{ playerId: PlayerId }> {
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias,
      discordId: null,
      serverId: testGuildId("123456789012345678"),
      creatorDiscordId: testAccountId("987654321098765432"),
      createdTime: now,
      updatedTime: now,
      accounts: {
        create: [
          {
            alias,
            puuid,
            region,
            serverId: testGuildId("123456789012345678"),
            creatorDiscordId: testAccountId("987654321098765432"),
            createdTime: now,
            updatedTime: now,
          },
        ],
      },
    },
  });
  return { playerId: player.id };
}

async function addTestParticipant(
  competitionId: CompetitionId,
  playerId: PlayerId,
): Promise<void> {
  const now = new Date();
  await prisma.competitionParticipant.create({
    data: {
      competitionId,
      playerId,
      status: "JOINED",
      joinedAt: now,
    },
  });
}

beforeEach(async () => {
  // Clean up before each test
  await prisma.competitionSnapshot.deleteMany();
  await prisma.competitionParticipant.deleteMany();
  await prisma.competition.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

// ============================================================================
// Query Tests - Finding Competitions to Start
// ============================================================================

describe("Competition Lifecycle - Query for Starting", () => {
  test("finds competition with past start date and no START snapshots", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date("2025-01-15T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T12:00:00Z");

    const { competitionId } = await createTestCompetition(
      criteria,
      startDate,
      endDate,
    );

    // Query for competitions to start
    const competitionsToStart = await prisma.competition.findMany({
      where: {
        isCancelled: false,
        startDate: {
          lte: now,
        },
        snapshots: {
          none: {
            snapshotType: "START",
          },
        },
      },
    });

    expect(competitionsToStart.length).toBe(1);
    expect(competitionsToStart[0]?.id).toBe(competitionId);
  });

  test("does not find competition with future start date", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date("2025-01-15T12:00:00Z");
    const startDate = new Date("2025-01-15T14:00:00Z"); // Future
    const endDate = new Date("2025-01-20T12:00:00Z");

    await createTestCompetition(criteria, startDate, endDate);

    // Query for competitions to start
    const competitionsToStart = await prisma.competition.findMany({
      where: {
        isCancelled: false,
        startDate: {
          lte: now,
        },
        snapshots: {
          none: {
            snapshotType: "START",
          },
        },
      },
    });

    expect(competitionsToStart.length).toBe(0);
  });

  test("does not find cancelled competition", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date("2025-01-15T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T12:00:00Z");

    const { competitionId } = await createTestCompetition(
      criteria,
      startDate,
      endDate,
    );

    // Cancel the competition
    await prisma.competition.update({
      where: { id: competitionId },
      data: { isCancelled: true },
    });

    // Query for competitions to start
    const competitionsToStart = await prisma.competition.findMany({
      where: {
        isCancelled: false,
        startDate: {
          lte: now,
        },
        snapshots: {
          none: {
            snapshotType: "START",
          },
        },
      },
    });

    expect(competitionsToStart.length).toBe(0);
  });

  test("does not find competition that already has START snapshots", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date("2025-01-15T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T12:00:00Z");

    const { competitionId } = await createTestCompetition(
      criteria,
      startDate,
      endDate,
    );

    // Add a player and create START snapshot
    const { playerId } = await createTestPlayer(
      "Player1",
      testPuuid("lifecycle-player1"),
      "AMERICA_NORTH",
    );
    await addTestParticipant(competitionId, playerId);

    await prisma.competitionSnapshot.create({
      data: {
        competitionId,
        playerId,
        snapshotType: "START",
        snapshotData: JSON.stringify({ soloGames: 10 }),
        snapshotTime: startDate,
      },
    });

    // Query for competitions to start
    const competitionsToStart = await prisma.competition.findMany({
      where: {
        isCancelled: false,
        startDate: {
          lte: now,
        },
        snapshots: {
          none: {
            snapshotType: "START",
          },
        },
      },
    });

    expect(competitionsToStart.length).toBe(0);
  });
});

// ============================================================================
// Query Tests - Finding Competitions to End
// ============================================================================

describe("Competition Lifecycle - Query for Ending", () => {
  test("finds competition with past end date and START but no END snapshots", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date("2025-01-20T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T10:00:00Z"); // Past

    const { competitionId } = await createTestCompetition(
      criteria,
      startDate,
      endDate,
    );

    // Add a player and create START snapshot
    const { playerId } = await createTestPlayer(
      "Player1",
      testPuuid("lifecycle-player1"),
      "AMERICA_NORTH",
    );
    await addTestParticipant(competitionId, playerId);

    await prisma.competitionSnapshot.create({
      data: {
        competitionId,
        playerId,
        snapshotType: "START",
        snapshotData: JSON.stringify({ soloGames: 10 }),
        snapshotTime: startDate,
      },
    });

    // Query for competitions to end
    const competitionsToEnd = await prisma.competition.findMany({
      where: {
        isCancelled: false,
        endDate: {
          lte: now,
        },
        snapshots: {
          some: {
            snapshotType: "START",
          },
        },
        NOT: {
          snapshots: {
            some: {
              snapshotType: "END",
            },
          },
        },
      },
    });

    expect(competitionsToEnd.length).toBe(1);
    expect(competitionsToEnd[0]?.id).toBe(competitionId);
  });

  test("does not find competition with future end date", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date("2025-01-18T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T10:00:00Z"); // Future

    const { competitionId } = await createTestCompetition(
      criteria,
      startDate,
      endDate,
    );

    // Add START snapshot
    const { playerId } = await createTestPlayer(
      "Player1",
      testPuuid("lifecycle-player1"),
      "AMERICA_NORTH",
    );
    await addTestParticipant(competitionId, playerId);

    await prisma.competitionSnapshot.create({
      data: {
        competitionId,
        playerId,
        snapshotType: "START",
        snapshotData: JSON.stringify({ soloGames: 10 }),
        snapshotTime: startDate,
      },
    });

    // Query for competitions to end
    const competitionsToEnd = await prisma.competition.findMany({
      where: {
        isCancelled: false,
        endDate: {
          lte: now,
        },
        snapshots: {
          some: {
            snapshotType: "START",
          },
        },
        NOT: {
          snapshots: {
            some: {
              snapshotType: "END",
            },
          },
        },
      },
    });

    expect(competitionsToEnd.length).toBe(0);
  });

  test("does not find competition without START snapshots", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date("2025-01-20T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T10:00:00Z");

    await createTestCompetition(criteria, startDate, endDate);

    // Query for competitions to end (no START snapshot exists)
    const competitionsToEnd = await prisma.competition.findMany({
      where: {
        isCancelled: false,
        endDate: {
          lte: now,
        },
        snapshots: {
          some: {
            snapshotType: "START",
          },
        },
        NOT: {
          snapshots: {
            some: {
              snapshotType: "END",
            },
          },
        },
      },
    });

    expect(competitionsToEnd.length).toBe(0);
  });

  test("does not find competition that already has END snapshots", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date("2025-01-20T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T10:00:00Z");

    const { competitionId } = await createTestCompetition(
      criteria,
      startDate,
      endDate,
    );

    // Add START and END snapshots
    const { playerId } = await createTestPlayer(
      "Player1",
      testPuuid("lifecycle-player1"),
      "AMERICA_NORTH",
    );
    await addTestParticipant(competitionId, playerId);

    await prisma.competitionSnapshot.create({
      data: {
        competitionId,
        playerId,
        snapshotType: "START",
        snapshotData: JSON.stringify({ soloGames: 10 }),
        snapshotTime: startDate,
      },
    });

    await prisma.competitionSnapshot.create({
      data: {
        competitionId,
        playerId,
        snapshotType: "END",
        snapshotData: JSON.stringify({ soloGames: 20 }),
        snapshotTime: endDate,
      },
    });

    // Query for competitions to end
    const competitionsToEnd = await prisma.competition.findMany({
      where: {
        isCancelled: false,
        endDate: {
          lte: now,
        },
        snapshots: {
          some: {
            snapshotType: "START",
          },
        },
        NOT: {
          snapshots: {
            some: {
              snapshotType: "END",
            },
          },
        },
      },
    });

    expect(competitionsToEnd.length).toBe(0);
  });
});

// ============================================================================
// Multiple Competitions Tests
// ============================================================================

describe("Competition Lifecycle - Multiple Competitions", () => {
  test("correctly identifies multiple competitions needing transitions", async () => {
    const criteria: CompetitionCriteria = {
      type: "MOST_GAMES_PLAYED",
      queue: "SOLO",
    };

    const now = new Date("2025-01-18T12:00:00Z");

    // Competition 1: Should start (past start date, no START snapshots)
    const { competitionId: comp1 } = await createTestCompetition(
      criteria,
      new Date("2025-01-18T10:00:00Z"),
      new Date("2025-01-25T10:00:00Z"),
    );

    // Competition 2: Should NOT start (future start date)
    await createTestCompetition(
      criteria,
      new Date("2025-01-19T10:00:00Z"),
      new Date("2025-01-25T10:00:00Z"),
    );

    // Competition 3: Should end (past end date, has START, no END)
    const { competitionId: comp3 } = await createTestCompetition(
      criteria,
      new Date("2025-01-10T10:00:00Z"),
      new Date("2025-01-18T10:00:00Z"),
    );

    // Competition 4: Should NOT end (future end date)
    const { competitionId: comp4 } = await createTestCompetition(
      criteria,
      new Date("2025-01-15T10:00:00Z"),
      new Date("2025-01-19T10:00:00Z"),
    );

    // Add START snapshots for comp3 and comp4
    const { playerId } = await createTestPlayer(
      "Player1",
      testPuuid("lifecycle-player1"),
      "AMERICA_NORTH",
    );

    await addTestParticipant(comp3, playerId);
    await addTestParticipant(comp4, playerId);

    await prisma.competitionSnapshot.create({
      data: {
        competitionId: comp3,
        playerId,
        snapshotType: "START",
        snapshotData: JSON.stringify({ soloGames: 10 }),
        snapshotTime: new Date("2025-01-10T10:00:00Z"),
      },
    });

    await prisma.competitionSnapshot.create({
      data: {
        competitionId: comp4,
        playerId,
        snapshotType: "START",
        snapshotData: JSON.stringify({ soloGames: 10 }),
        snapshotTime: new Date("2025-01-15T10:00:00Z"),
      },
    });

    // Query for competitions to start
    const competitionsToStart = await prisma.competition.findMany({
      where: {
        isCancelled: false,
        startDate: { lte: now },
        snapshots: {
          none: {
            snapshotType: "START",
          },
        },
      },
    });

    // Query for competitions to end
    const competitionsToEnd = await prisma.competition.findMany({
      where: {
        isCancelled: false,
        endDate: { lte: now },
        snapshots: {
          some: {
            snapshotType: "START",
          },
        },
        NOT: {
          snapshots: {
            some: {
              snapshotType: "END",
            },
          },
        },
      },
    });

    // Verify correct competitions identified
    expect(competitionsToStart.length).toBe(1);
    expect(competitionsToStart[0]?.id).toBe(comp1);

    expect(competitionsToEnd.length).toBe(1);
    expect(competitionsToEnd[0]?.id).toBe(comp3);
  });
});
