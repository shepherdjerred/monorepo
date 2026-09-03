import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  CompetitionCriteria,
  LeaguePuuid,
  Region,
} from "@scout-for-lol/data";
import { testPuuid } from "#src/testing/test-ids.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  addCompetitionParticipantFixture,
  createCompetitionFixture,
  createCompetitionPlayerFixture,
  resetCompetitionFixtures,
} from "#src/testing/competition-fixtures.ts";

let sendShouldFail = false;
let sentMessages: { channelId: string; content: string }[] = [];

class ChannelSendError extends Error {
  constructor(
    message: string,
    public readonly channelId: string,
    public readonly permissionError: boolean,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ChannelSendError";
  }
}

vi.doMock("../../discord/channel.js", () => ({
  send: (message: string, channelId: string) => {
    if (sendShouldFail) {
      return Promise.reject(new Error("temporary discord failure"));
    }
    sentMessages.push({ channelId, content: message });
    return Promise.resolve({ id: "mock-message-id" });
  },
  ChannelSendError,
}));

// Create a test database
const { prisma } = createTestDatabase("lifecycle-test");
const { handleCompetitionStarts } = await import("./lifecycle.js");
const mostSoloGamesCriteria: CompetitionCriteria = {
  type: "MOST_GAMES_PLAYED",
  queues: ["solo"],
};

// Test helpers
async function createTestCompetition(
  criteria: CompetitionCriteria,
  startDate: Date,
  endDate: Date,
) {
  const competition = await createCompetitionFixture(prisma, {
    criteria,
    startDate,
    endDate,
  });
  return { competitionId: competition.id };
}

async function createTestPlayer(
  alias: string,
  puuid: LeaguePuuid,
  region: Region,
) {
  const player = await createCompetitionPlayerFixture(prisma, {
    alias,
    puuid,
    region,
  });
  return { playerId: player.id };
}

async function addTestParticipant(
  competitionId: Parameters<typeof addCompetitionParticipantFixture>[1],
  playerId: Parameters<typeof addCompetitionParticipantFixture>[2],
): Promise<void> {
  await addCompetitionParticipantFixture(prisma, competitionId, playerId);
}

function findCompetitionsToStart(now: Date) {
  return prisma.competition.findMany({
    where: {
      isCancelled: false,
      startDate: { lte: now },
      snapshots: { none: { snapshotType: "START" } },
    },
  });
}

function findCompetitionsToEnd(now: Date) {
  return prisma.competition.findMany({
    where: {
      isCancelled: false,
      endDate: { lte: now },
      snapshots: { some: { snapshotType: "START" } },
      NOT: { snapshots: { some: { snapshotType: "END" } } },
    },
  });
}

async function createStartedCompetition(startDate: Date, endDate: Date) {
  const { competitionId } = await createTestCompetition(
    mostSoloGamesCriteria,
    startDate,
    endDate,
  );
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
  return { competitionId, playerId };
}

beforeEach(async () => {
  sendShouldFail = false;
  sentMessages = [];
  await resetCompetitionFixtures(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

// ============================================================================
// Query Tests - Finding Competitions to Start
// ============================================================================

describe("Competition Lifecycle - Query for Starting", () => {
  test("finds competition with past start date and no START snapshots", async () => {
    const criteria = mostSoloGamesCriteria;

    const now = new Date("2025-01-15T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T12:00:00Z");

    const { competitionId } = await createTestCompetition(
      criteria,
      startDate,
      endDate,
    );

    const competitionsToStart = await findCompetitionsToStart(now);

    expect(competitionsToStart.length).toBe(1);
    expect(competitionsToStart[0]?.id).toBe(competitionId);
  });

  test("does not find competition with future start date", async () => {
    const criteria = mostSoloGamesCriteria;

    const now = new Date("2025-01-15T12:00:00Z");
    const startDate = new Date("2025-01-15T14:00:00Z"); // Future
    const endDate = new Date("2025-01-20T12:00:00Z");

    await createTestCompetition(criteria, startDate, endDate);

    const competitionsToStart = await findCompetitionsToStart(now);

    expect(competitionsToStart.length).toBe(0);
  });

  test("does not find cancelled competition", async () => {
    const criteria = mostSoloGamesCriteria;

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

    const competitionsToStart = await findCompetitionsToStart(now);

    expect(competitionsToStart.length).toBe(0);
  });

  test("does not find competition that already has START snapshots", async () => {
    const now = new Date("2025-01-15T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T12:00:00Z");

    await createStartedCompetition(startDate, endDate);

    const competitionsToStart = await findCompetitionsToStart(now);

    expect(competitionsToStart.length).toBe(0);
  });
});

describe("Competition Lifecycle - Start Retry Semantics", () => {
  test("does not mark start processed when start notification fails", async () => {
    const criteria = mostSoloGamesCriteria;
    const now = new Date("2025-01-15T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T12:00:00Z");
    const { competitionId } = await createTestCompetition(
      criteria,
      startDate,
      endDate,
    );
    const { playerId } = await createTestPlayer(
      "Player One",
      testPuuid("life1"),
      "AMERICA_NORTH",
    );
    await addTestParticipant(competitionId, playerId);

    sendShouldFail = true;
    await handleCompetitionStarts(prisma, now);

    const afterFailure = await prisma.competition.findUniqueOrThrow({
      where: { id: competitionId },
    });
    expect(afterFailure.startProcessedAt).toBeNull();
    expect(afterFailure.startNotifiedAt).toBeNull();

    sendShouldFail = false;
    await handleCompetitionStarts(prisma, now);

    const afterRetry = await prisma.competition.findUniqueOrThrow({
      where: { id: competitionId },
    });
    expect(afterRetry.startProcessedAt).toEqual(now);
    expect(afterRetry.startNotifiedAt).toEqual(now);
    expect(afterRetry.startNotificationMessageId).toBe("mock-message-id");
    expect(sentMessages).toHaveLength(1);
  });
});

// ============================================================================
// Query Tests - Finding Competitions to End
// ============================================================================

describe("Competition Lifecycle - Query for Ending", () => {
  test("finds competition with past end date and START but no END snapshots", async () => {
    const criteria = mostSoloGamesCriteria;

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

    const competitionsToEnd = await findCompetitionsToEnd(now);

    expect(competitionsToEnd.length).toBe(1);
    expect(competitionsToEnd[0]?.id).toBe(competitionId);
  });

  test("does not find competition with future end date", async () => {
    const now = new Date("2025-01-18T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T10:00:00Z"); // Future

    await createStartedCompetition(startDate, endDate);

    const competitionsToEnd = await findCompetitionsToEnd(now);

    expect(competitionsToEnd.length).toBe(0);
  });

  test("does not find competition without START snapshots", async () => {
    const criteria = mostSoloGamesCriteria;

    const now = new Date("2025-01-20T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T10:00:00Z");

    await createTestCompetition(criteria, startDate, endDate);

    const competitionsToEnd = await findCompetitionsToEnd(now);

    expect(competitionsToEnd.length).toBe(0);
  });

  test("does not find competition that already has END snapshots", async () => {
    const now = new Date("2025-01-20T12:00:00Z");
    const startDate = new Date("2025-01-15T10:00:00Z");
    const endDate = new Date("2025-01-20T10:00:00Z");

    const { competitionId, playerId } = await createStartedCompetition(
      startDate,
      endDate,
    );

    await prisma.competitionSnapshot.create({
      data: {
        competitionId,
        playerId,
        snapshotType: "END",
        snapshotData: JSON.stringify({ soloGames: 20 }),
        snapshotTime: endDate,
      },
    });

    const competitionsToEnd = await findCompetitionsToEnd(now);

    expect(competitionsToEnd.length).toBe(0);
  });
});

// ============================================================================
// Multiple Competitions Tests
// ============================================================================

describe("Competition Lifecycle - Multiple Competitions", () => {
  test("correctly identifies multiple competitions needing transitions", async () => {
    const criteria = mostSoloGamesCriteria;

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
