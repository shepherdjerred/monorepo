import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { MatchIdSchema } from "@scout-for-lol/data";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import { enqueueInitialMatchHistoryImport } from "#src/league/initial-history/enqueue.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

const { prisma } = createTestDatabase("initial-history-enqueue");
const puuid = testPuuid("initial-history-puuid");

beforeEach(async () => {
  await deleteIfExists(() => prisma.initialMatchHistoryImport.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("initial history enqueue", () => {
  test("rolls back with the account-creation transaction", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueInitialMatchHistoryImport({
          puuid,
          region: "AMERICA_NORTH",
          db: tx,
        });
        throw new Error("rollback account create");
      }),
    ).rejects.toThrow("rollback account create");

    expect(await prisma.initialMatchHistoryImport.count()).toBe(0);
  });

  test("deduplicates concurrent cross-guild requests by PUUID", async () => {
    await Promise.all([
      prisma.$transaction((tx) =>
        enqueueInitialMatchHistoryImport({
          puuid,
          region: "AMERICA_NORTH",
          db: tx,
        }),
      ),
      prisma.$transaction((tx) =>
        enqueueInitialMatchHistoryImport({
          puuid,
          region: "AMERICA_NORTH",
          db: tx,
        }),
      ),
    ]);

    expect(await prisma.initialMatchHistoryImport.count()).toBe(1);
  });

  test("reuses a recent import only to republish guild identity", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    await prisma.initialMatchHistoryImport.create({
      data: {
        puuid,
        region: "AMERICA_NORTH",
        phase: "complete",
        matchIdsJson: JSON.stringify(["NA1_1"]),
        nextMatchIndex: 1,
        newestMatchId: "NA1_1",
        cursorHandedOffAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
        nextAttemptAt: now,
        requestedAt: now,
        completedAt: now,
        lastImportedAt: new Date(now.getTime() - 60 * 60 * 1000),
      },
    });

    const activeRequestAt = new Date("2026-08-23T12:05:00.000Z");
    await prisma.$transaction((tx) =>
      enqueueInitialMatchHistoryImport({
        puuid,
        region: "AMERICA_NORTH",
        db: tx,
        requestedAt: activeRequestAt,
      }),
    );

    const job = await prisma.initialMatchHistoryImport.findUniqueOrThrow({
      where: { puuid },
    });
    expect(job.phase).toBe("publish");
    expect(job.matchIdsJson).toBe(JSON.stringify(["NA1_1"]));
    expect(job.nextMatchIndex).toBe(1);
  });

  test("seeds a reused account from the most advanced shared cursor", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const existingPlayer = await prisma.player.create({
      data: {
        alias: "Existing",
        serverId: testGuildId("4101"),
        creatorDiscordId: testAccountId("5101"),
        createdTime: now,
        updatedTime: now,
      },
    });
    const newPlayer = await prisma.player.create({
      data: {
        alias: "New",
        serverId: testGuildId("4102"),
        creatorDiscordId: testAccountId("5101"),
        createdTime: now,
        updatedTime: now,
      },
    });
    await prisma.account.create({
      data: {
        alias: "Existing",
        puuid,
        region: "AMERICA_NORTH",
        playerId: existingPlayer.id,
        serverId: existingPlayer.serverId,
        creatorDiscordId: testAccountId("5101"),
        lastProcessedMatchId: MatchIdSchema.parse("NA1_3"),
        lastMatchTime: new Date("2026-08-23T11:30:00.000Z"),
        lastCheckedAt: new Date("2026-08-23T11:35:00.000Z"),
        createdTime: now,
        updatedTime: now,
      },
    });
    const newAccount = await prisma.account.create({
      data: {
        alias: "New",
        puuid,
        region: "AMERICA_NORTH",
        playerId: newPlayer.id,
        serverId: newPlayer.serverId,
        creatorDiscordId: testAccountId("5101"),
        createdTime: now,
        updatedTime: now,
      },
    });
    await prisma.initialMatchHistoryImport.create({
      data: {
        puuid,
        region: "AMERICA_NORTH",
        phase: "complete",
        matchIdsJson: JSON.stringify(["NA1_1"]),
        nextMatchIndex: 1,
        newestMatchId: "NA1_1",
        newestMatchTime: new Date("2026-08-23T10:00:00.000Z"),
        cursorHandedOffAt: new Date("2026-08-23T10:05:00.000Z"),
        nextAttemptAt: now,
        requestedAt: now,
        completedAt: now,
        lastImportedAt: new Date("2026-08-23T10:10:00.000Z"),
      },
    });

    await prisma.$transaction((tx) =>
      enqueueInitialMatchHistoryImport({
        puuid,
        region: "AMERICA_NORTH",
        db: tx,
        requestedAt: now,
      }),
    );

    await expect(
      prisma.account.findUniqueOrThrow({ where: { id: newAccount.id } }),
    ).resolves.toMatchObject({
      lastProcessedMatchId: "NA1_3",
      lastMatchTime: new Date("2026-08-23T11:30:00.000Z"),
      lastCheckedAt: new Date("2026-08-23T11:35:00.000Z"),
    });

    await prisma.account.update({
      where: { id: newAccount.id },
      data: {
        lastProcessedMatchId: null,
        lastMatchTime: null,
        lastCheckedAt: null,
      },
    });
    const activeRequestAt = new Date("2026-08-23T12:05:00.000Z");
    await prisma.$transaction((tx) =>
      enqueueInitialMatchHistoryImport({
        puuid,
        region: "AMERICA_NORTH",
        db: tx,
        requestedAt: activeRequestAt,
      }),
    );
    await expect(
      prisma.account.findUniqueOrThrow({ where: { id: newAccount.id } }),
    ).resolves.toMatchObject({
      lastProcessedMatchId: "NA1_3",
      lastMatchTime: new Date("2026-08-23T11:30:00.000Z"),
      lastCheckedAt: new Date("2026-08-23T11:35:00.000Z"),
    });
    await expect(
      prisma.initialMatchHistoryImport.findUniqueOrThrow({ where: { puuid } }),
    ).resolves.toMatchObject({
      phase: "publish",
      requestedAt: activeRequestAt,
    });
  });
});

describe("initial history enqueue recovery", () => {
  test("allows a Riot refetch after the 24-hour cooldown", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    await prisma.initialMatchHistoryImport.create({
      data: {
        puuid,
        region: "AMERICA_NORTH",
        phase: "complete",
        matchIdsJson: JSON.stringify(["NA1_1"]),
        nextMatchIndex: 1,
        newestMatchId: "NA1_1",
        nextAttemptAt: now,
        requestedAt: now,
        completedAt: now,
        lastImportedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
      },
    });

    await prisma.$transaction((tx) =>
      enqueueInitialMatchHistoryImport({
        puuid,
        region: "AMERICA_NORTH",
        db: tx,
        requestedAt: now,
      }),
    );

    const job = await prisma.initialMatchHistoryImport.findUniqueOrThrow({
      where: { puuid },
    });
    expect(job).toMatchObject({
      phase: "queued",
      matchIdsJson: null,
      nextMatchIndex: 0,
      newestMatchId: null,
      cursorHandedOffAt: null,
      lastImportedAt: null,
    });
  });

  test("resumes a repaired pre-handoff terminal failure", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    await prisma.initialMatchHistoryImport.create({
      data: {
        puuid,
        region: "AMERICA_NORTH",
        phase: "failed",
        matchIdsJson: JSON.stringify(["NA1_2", "NA1_1"]),
        snapshotAt: new Date(now.getTime() - 60 * 60 * 1000),
        nextMatchIndex: 1,
        newestMatchId: "NA1_2",
        attemptCount: 4,
        nextAttemptAt: now,
        requestedAt: new Date(now.getTime() - 60 * 60 * 1000),
        completedAt: new Date(now.getTime() - 30 * 60 * 1000),
        errorCode: "contract",
      },
    });

    await prisma.$transaction((tx) =>
      enqueueInitialMatchHistoryImport({
        puuid,
        region: "AMERICA_NORTH",
        db: tx,
        requestedAt: now,
      }),
    );

    expect(
      await prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid },
      }),
    ).toMatchObject({
      phase: "matches",
      nextMatchIndex: 1,
      attemptCount: 0,
      errorCode: null,
      completedAt: null,
      nextAttemptAt: now,
    });
  });

  test("resumes a recent partial snapshot after delete and re-add", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    await prisma.initialMatchHistoryImport.create({
      data: {
        puuid,
        region: "AMERICA_NORTH",
        phase: "complete",
        matchIdsJson: JSON.stringify(["NA1_2", "NA1_1"]),
        snapshotAt: new Date(now.getTime() - 60 * 60 * 1000),
        nextMatchIndex: 1,
        newestMatchId: "NA1_2",
        nextAttemptAt: now,
        requestedAt: now,
        completedAt: now,
        errorCode: "untracked",
      },
    });

    await prisma.$transaction((tx) =>
      enqueueInitialMatchHistoryImport({
        puuid,
        region: "AMERICA_NORTH",
        db: tx,
        requestedAt: now,
      }),
    );

    expect(
      await prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid },
      }),
    ).toMatchObject({
      phase: "matches",
      nextMatchIndex: 1,
      newestMatchId: "NA1_2",
      errorCode: null,
    });
  });

  test("re-enters cursor handoff when every snapshot match was stored before removal", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    await prisma.initialMatchHistoryImport.create({
      data: {
        puuid,
        region: "AMERICA_NORTH",
        phase: "complete",
        matchIdsJson: JSON.stringify(["NA1_2", "NA1_1"]),
        snapshotAt: new Date(now.getTime() - 60 * 60 * 1000),
        nextMatchIndex: 2,
        newestMatchId: "NA1_2",
        nextAttemptAt: now,
        requestedAt: now,
        completedAt: now,
        errorCode: "untracked",
      },
    });

    await prisma.$transaction((tx) =>
      enqueueInitialMatchHistoryImport({
        puuid,
        region: "AMERICA_NORTH",
        db: tx,
        requestedAt: now,
      }),
    );

    expect(
      await prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid },
      }),
    ).toMatchObject({
      phase: "matches",
      nextMatchIndex: 2,
      cursorHandedOffAt: null,
      errorCode: null,
    });
  });
});
