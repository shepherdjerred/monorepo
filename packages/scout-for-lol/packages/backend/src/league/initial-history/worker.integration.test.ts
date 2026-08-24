import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  MatchIdSchema,
  RawMatchSchema,
  type MatchId,
  type RawMatch,
} from "@scout-for-lol/data";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { RiotHttpError } from "#src/league/api/client/errors.ts";
import { filterNewMatches } from "#src/league/api/match-history.ts";

const { prisma } = createTestDatabase("initial-history-worker");
const importedPuuid = testPuuid("initial-worker");
const matchIds = Array.from({ length: 20 }, (_, index) =>
  MatchIdSchema.parse(`NA1_${(20 - index).toString()}`),
);
const rawFixture = RawMatchSchema.parse(
  await Bun.file(
    new URL(
      "../model/__tests__/testdata/matches_2025_09_19_NA1_5370986469.json",
      import.meta.url,
    ),
  ).json(),
);

function matchForId(matchId: MatchId) {
  return RawMatchSchema.parse({
    ...rawFixture,
    metadata: { ...rawFixture.metadata, matchId },
  });
}

const fetchInitialMatchIds = vi.fn(() => Promise.resolve(matchIds));
const fetchInitialMatch = vi.fn(
  (input: { matchId: MatchId }): Promise<RawMatch | null> =>
    Promise.resolve(matchForId(input.matchId)),
);
const fetchCurrentRanks = vi.fn(() =>
  Promise.resolve({
    solo: {
      tier: "gold",
      division: 2,
      lp: 61,
      wins: 12,
      losses: 9,
    },
    flex: undefined,
  }),
);
const recordMatchForReportStore = vi.fn(() =>
  Promise.resolve({ staged: true, stored: true }),
);
const runReportLakeFold = vi.fn(() => Promise.resolve({ buildId: "test" }));

vi.doMock("#src/league/initial-history/riot.ts", () => ({
  INITIAL_HISTORY_MATCH_COUNT: 20,
  fetchInitialMatchIds,
  fetchInitialMatch,
  fetchCurrentRanks,
}));
vi.doMock("#src/report-store/live-ingest.ts", () => ({
  recordMatchForReportStore,
}));
vi.doMock("#src/report-lake/compactor.ts", () => ({ runReportLakeFold }));

const { getPuuidsBlockedFromLivePolling } =
  await import("#src/league/initial-history/live-polling.ts");
const { enqueueInitialMatchHistoryImport } =
  await import("#src/league/initial-history/enqueue.ts");
const { resetInitialHistoryWorkerStateForTests, runInitialHistoryImportTick } =
  await import("#src/league/initial-history/worker.ts");

beforeEach(async () => {
  resetInitialHistoryWorkerStateForTests();
  vi.clearAllMocks();
  await deleteIfExists(() => prisma.initialMatchHistoryImport.deleteMany());
  await deleteIfExists(() => prisma.currentRankSnapshot.deleteMany());
  await deleteIfExists(() => prisma.matchRankHistory.deleteMany());
  await deleteIfExists(() => prisma.bucksMatchEarning.deleteMany());
  await deleteIfExists(() => prisma.activeGame.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createTrackedJob(puuid = importedPuuid): Promise<void> {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const player = await prisma.player.create({
    data: {
      alias: `Player-${puuid}`,
      serverId: testGuildId("4100"),
      creatorDiscordId: testAccountId("5100"),
      createdTime: now,
      updatedTime: now,
    },
  });
  await prisma.account.create({
    data: {
      alias: `Account-${puuid}`,
      puuid,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId: testGuildId("4100"),
      creatorDiscordId: testAccountId("5100"),
      createdTime: now,
      updatedTime: now,
    },
  });
  await prisma.initialMatchHistoryImport.create({
    data: {
      puuid,
      region: "AMERICA_NORTH",
      phase: "queued",
      nextAttemptAt: now,
      requestedAt: now,
    },
  });
}

async function verifyConcurrentReenqueueWins(): Promise<void> {
  const initialRequestAt = new Date("2026-08-23T12:00:00.000Z");
  const newRequestAt = new Date("2026-08-23T12:01:00.000Z");
  await prisma.initialMatchHistoryImport.create({
    data: {
      puuid: importedPuuid,
      region: "AMERICA_NORTH",
      phase: "queued",
      nextAttemptAt: initialRequestAt,
      requestedAt: initialRequestAt,
    },
  });
  const transactionReady = Promise.withResolvers<undefined>();
  const releaseTransaction = Promise.withResolvers<undefined>();
  const accountCreation = prisma.$transaction(async (tx) => {
    const player = await tx.player.create({
      data: {
        alias: "Re-added Player",
        serverId: testGuildId("4100"),
        creatorDiscordId: testAccountId("5100"),
        createdTime: newRequestAt,
        updatedTime: newRequestAt,
      },
    });
    await tx.account.create({
      data: {
        alias: "Re-added Account",
        puuid: importedPuuid,
        region: "AMERICA_NORTH",
        playerId: player.id,
        serverId: testGuildId("4100"),
        creatorDiscordId: testAccountId("5100"),
        createdTime: newRequestAt,
        updatedTime: newRequestAt,
      },
    });
    await enqueueInitialMatchHistoryImport({
      puuid: importedPuuid,
      region: "AMERICA_NORTH",
      db: tx,
      requestedAt: newRequestAt,
    });
    transactionReady.resolve(undefined);
    await releaseTransaction.promise;
  });
  await transactionReady.promise;

  const workerTick = runInitialHistoryImportTick(prisma, initialRequestAt);
  await new Promise((resolve) => setTimeout(resolve, 25));
  releaseTransaction.resolve(undefined);
  await Promise.all([accountCreation, workerTick]);

  await expect(
    prisma.initialMatchHistoryImport.findUniqueOrThrow({
      where: { puuid: importedPuuid },
    }),
  ).resolves.toMatchObject({
    phase: "queued",
    requestedAt: newRequestAt,
    completedAt: null,
    errorCode: null,
  });
  expect(fetchInitialMatchIds).not.toHaveBeenCalled();
  expect(await getPuuidsBlockedFromLivePolling(prisma)).toContain(
    importedPuuid,
  );
}

describe("initial history worker", () => {
  test("imports exactly 20 games in five budgeted ticks and publishes quietly", async () => {
    await createTrackedJob();

    expect(await getPuuidsBlockedFromLivePolling(prisma)).toContain(
      importedPuuid,
    );
    for (let minute = 0; minute < 5; minute += 1) {
      await runInitialHistoryImportTick(
        prisma,
        new Date(`2026-08-23T12:0${minute.toString()}:00.000Z`),
      );
      const expectedCalls = [4, 9, 14, 19, 20][minute];
      if (expectedCalls === undefined) throw new Error("missing call budget");
      expect(fetchInitialMatch).toHaveBeenCalledTimes(expectedCalls);
    }

    const job = await prisma.initialMatchHistoryImport.findUniqueOrThrow({
      where: { puuid: importedPuuid },
    });
    const account = await prisma.account.findFirstOrThrow({
      where: { puuid: importedPuuid },
    });
    const rank = await prisma.currentRankSnapshot.findUniqueOrThrow({
      where: { puuid: importedPuuid },
    });
    expect(job).toMatchObject({
      phase: "complete",
      nextMatchIndex: 20,
      newestMatchId: matchIds[0],
      cursorHandedOffAt: new Date("2026-08-23T12:04:00.000Z"),
      errorCode: null,
    });
    expect(account.lastProcessedMatchId).toBe(matchIds[0]);
    const completedDuringImport = MatchIdSchema.parse("NA1_21");
    expect(
      filterNewMatches(
        [completedDuringImport, ...matchIds],
        account.lastProcessedMatchId,
      ),
    ).toEqual({ matchIds: [completedDuringImport], gapDetected: false });
    expect(rank.soloRank).toContain('"tier":"gold"');
    expect(rank.flexRank).toBeNull();
    expect(fetchInitialMatchIds).toHaveBeenCalledTimes(1);
    expect(fetchInitialMatch).toHaveBeenCalledTimes(20);
    expect(fetchCurrentRanks).toHaveBeenCalledTimes(1);
    expect(recordMatchForReportStore).toHaveBeenCalledTimes(20);
    expect(runReportLakeFold).toHaveBeenCalledTimes(1);
    expect(await getPuuidsBlockedFromLivePolling(prisma)).not.toContain(
      importedPuuid,
    );

    expect(await prisma.matchRankHistory.count()).toBe(0);
    expect(await prisma.activeGame.count()).toBe(0);
    expect(await prisma.bucksMatchEarning.count()).toBe(0);
  });

  test("rotates fairly between due PUUIDs", async () => {
    const secondPuuid = testPuuid("initial-worker-second");
    await createTrackedJob(importedPuuid);
    await createTrackedJob(secondPuuid);

    await runInitialHistoryImportTick(
      prisma,
      new Date("2026-08-23T12:00:00.000Z"),
    );
    await runInitialHistoryImportTick(
      prisma,
      new Date("2026-08-23T12:01:00.000Z"),
    );

    const jobs = await prisma.initialMatchHistoryImport.findMany({
      orderBy: { puuid: "asc" },
    });
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.nextMatchIndex === 4)).toBe(true);
  });

  test("cancels without Riot traffic when no account remains", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    await prisma.initialMatchHistoryImport.create({
      data: {
        puuid: importedPuuid,
        region: "AMERICA_NORTH",
        phase: "queued",
        nextAttemptAt: now,
        requestedAt: now,
      },
    });

    await runInitialHistoryImportTick(prisma, now);

    expect(fetchInitialMatchIds).not.toHaveBeenCalled();
    expect(
      await prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid: importedPuuid },
      }),
    ).toMatchObject({ phase: "complete", errorCode: "untracked" });
  });

  test("does not overwrite an account creation that re-enqueues the job", async () => {
    await verifyConcurrentReenqueueWins();
  });

  test("completes an empty history and establishes the present as the cursor boundary", async () => {
    fetchInitialMatchIds.mockResolvedValueOnce([]);
    const now = new Date("2026-08-23T12:00:00.000Z");
    await createTrackedJob();

    await runInitialHistoryImportTick(prisma, now);

    const job = await prisma.initialMatchHistoryImport.findUniqueOrThrow({
      where: { puuid: importedPuuid },
    });
    const account = await prisma.account.findFirstOrThrow({
      where: { puuid: importedPuuid },
    });
    expect(job.phase).toBe("complete");
    expect(account.lastProcessedMatchId).toBeNull();
    expect(account.lastCheckedAt).toEqual(now);
    expect(fetchInitialMatch).not.toHaveBeenCalled();
    expect(fetchCurrentRanks).toHaveBeenCalledTimes(1);
  });

  test("imports fewer than 20 available games without padding the snapshot", async () => {
    const shortHistory = matchIds.slice(0, 3);
    fetchInitialMatchIds.mockResolvedValueOnce(shortHistory);
    await createTrackedJob();

    await runInitialHistoryImportTick(
      prisma,
      new Date("2026-08-23T12:00:00.000Z"),
    );

    const job = await prisma.initialMatchHistoryImport.findUniqueOrThrow({
      where: { puuid: importedPuuid },
    });
    expect(job).toMatchObject({
      phase: "complete",
      matchIdsJson: JSON.stringify(shortHistory),
      nextMatchIndex: 3,
    });
    expect(fetchInitialMatch).toHaveBeenCalledTimes(3);
    expect(fetchCurrentRanks).toHaveBeenCalledTimes(1);
  });

  test("checkpoints a permanently missing individual match and continues", async () => {
    fetchInitialMatch.mockResolvedValueOnce(null);
    await createTrackedJob();

    await runInitialHistoryImportTick(
      prisma,
      new Date("2026-08-23T12:00:00.000Z"),
    );

    const job = await prisma.initialMatchHistoryImport.findUniqueOrThrow({
      where: { puuid: importedPuuid },
    });
    expect(job).toMatchObject({ phase: "matches", nextMatchIndex: 4 });
    expect(fetchInitialMatch).toHaveBeenCalledTimes(4);
    expect(recordMatchForReportStore).toHaveBeenCalledTimes(3);
  });
});

describe("initial history worker failure handling", () => {
  test("retries Riot 429s after one minute without consuming another job checkpoint", async () => {
    fetchInitialMatchIds.mockRejectedValueOnce(
      new RiotHttpError({
        status: 429,
        statusText: "Too Many Requests",
        body: null,
        url: "https://riot.test/matches",
        headers: new Headers({ "retry-after": "60" }),
      }),
    );
    const now = new Date("2026-08-23T12:00:00.000Z");
    await createTrackedJob();

    await runInitialHistoryImportTick(prisma, now);

    expect(
      await prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid: importedPuuid },
      }),
    ).toMatchObject({
      phase: "queued",
      attemptCount: 1,
      errorCode: "rate_limit",
      nextAttemptAt: new Date("2026-08-23T12:01:00.000Z"),
    });
  });

  test("backs repeated retryable failures off by 1, 5, 15, then 60 minutes", async () => {
    const rateLimitError = new RiotHttpError({
      status: 429,
      statusText: "Too Many Requests",
      body: null,
      url: "https://riot.test/matches",
      headers: new Headers(),
    });
    fetchInitialMatchIds
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError);
    await createTrackedJob();

    const attempts = [
      ["2026-08-23T12:00:00.000Z", "2026-08-23T12:01:00.000Z"],
      ["2026-08-23T12:01:00.000Z", "2026-08-23T12:06:00.000Z"],
      ["2026-08-23T12:06:00.000Z", "2026-08-23T12:21:00.000Z"],
      ["2026-08-23T12:21:00.000Z", "2026-08-23T13:21:00.000Z"],
    ];
    for (const [attemptAt, expectedNextAttemptAt] of attempts) {
      if (attemptAt === undefined || expectedNextAttemptAt === undefined) {
        throw new Error("missing retry schedule fixture");
      }
      await runInitialHistoryImportTick(prisma, new Date(attemptAt));
      const job = await prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid: importedPuuid },
      });
      expect(job.nextAttemptAt).toEqual(new Date(expectedNextAttemptAt));
    }
  });

  test("restarts backoff after progress within the same tick", async () => {
    const upstreamError = new RiotHttpError({
      status: 503,
      statusText: "Service Unavailable",
      body: null,
      url: "https://riot.test/match",
      headers: new Headers(),
    });
    fetchInitialMatch.mockRejectedValueOnce(upstreamError);
    const now = new Date("2026-08-23T12:00:00.000Z");
    await createTrackedJob();
    await prisma.initialMatchHistoryImport.update({
      where: { puuid: importedPuuid },
      data: { attemptCount: 4 },
    });

    await runInitialHistoryImportTick(prisma, now);

    expect(
      await prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid: importedPuuid },
      }),
    ).toMatchObject({
      phase: "matches",
      nextMatchIndex: 0,
      attemptCount: 1,
      nextAttemptAt: new Date("2026-08-23T12:01:00.000Z"),
    });
  });

  test("fails loudly on Riot authentication errors", async () => {
    fetchInitialMatchIds.mockRejectedValueOnce(
      new RiotHttpError({
        status: 403,
        statusText: "Forbidden",
        body: null,
        url: "https://riot.test/matches",
        headers: new Headers(),
      }),
    );
    const now = new Date("2026-08-23T12:00:00.000Z");
    await createTrackedJob();

    await runInitialHistoryImportTick(prisma, now);

    expect(
      await prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid: importedPuuid },
      }),
    ).toMatchObject({
      phase: "failed",
      errorCode: "authentication",
      completedAt: now,
    });
    expect(await getPuuidsBlockedFromLivePolling(prisma)).toContain(
      importedPuuid,
    );
  });

  test("does not block live polling after a post-handoff terminal failure", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    await createTrackedJob();
    await prisma.initialMatchHistoryImport.update({
      where: { puuid: importedPuuid },
      data: {
        phase: "failed",
        cursorHandedOffAt: now,
        errorCode: "contract",
        completedAt: now,
      },
    });

    expect(await getPuuidsBlockedFromLivePolling(prisma)).not.toContain(
      importedPuuid,
    );
  });
});

describe("initial history worker storage and publish failures", () => {
  test("does not checkpoint when canonical S3 storage is unavailable", async () => {
    recordMatchForReportStore.mockResolvedValueOnce({
      staged: true,
      stored: false,
    });
    const now = new Date("2026-08-23T12:00:00.000Z");
    await createTrackedJob();

    await runInitialHistoryImportTick(prisma, now);

    expect(
      await prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid: importedPuuid },
      }),
    ).toMatchObject({
      phase: "matches",
      nextMatchIndex: 0,
      attemptCount: 1,
      errorCode: "storage",
    });
  });

  test("does not checkpoint when immediate lake staging fails", async () => {
    recordMatchForReportStore.mockResolvedValueOnce({
      staged: false,
      stored: true,
    });
    const now = new Date("2026-08-23T12:00:00.000Z");
    await createTrackedJob();

    await runInitialHistoryImportTick(prisma, now);

    expect(
      await prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid: importedPuuid },
      }),
    ).toMatchObject({
      phase: "matches",
      nextMatchIndex: 0,
      attemptCount: 1,
      errorCode: "staging",
    });
  });

  test("retries a failed report-lake fold as a staging failure", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    runReportLakeFold.mockRejectedValueOnce(new Error("fold failed"));
    await createTrackedJob();
    await prisma.initialMatchHistoryImport.update({
      where: { puuid: importedPuuid },
      data: { phase: "publish" },
    });

    await runInitialHistoryImportTick(prisma, now);

    const job = await prisma.initialMatchHistoryImport.findUniqueOrThrow({
      where: { puuid: importedPuuid },
    });
    expect(job).toMatchObject({
      phase: "publish",
      attemptCount: 1,
      errorCode: "staging",
      nextAttemptAt: new Date("2026-08-23T12:01:00.000Z"),
    });
  });

  test("does not complete a publish generation accepted during the fold", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const newerRequestAt = new Date("2026-08-23T12:01:00.000Z");
    await createTrackedJob();
    await prisma.initialMatchHistoryImport.update({
      where: { puuid: importedPuuid },
      data: { phase: "publish" },
    });
    runReportLakeFold.mockImplementationOnce(async () => {
      await prisma.initialMatchHistoryImport.update({
        where: { puuid: importedPuuid },
        data: { requestedAt: newerRequestAt },
      });
      return { buildId: "stale-fold" };
    });

    await runInitialHistoryImportTick(prisma, now);

    await expect(
      prisma.initialMatchHistoryImport.findUniqueOrThrow({
        where: { puuid: importedPuuid },
      }),
    ).resolves.toMatchObject({
      phase: "publish",
      requestedAt: newerRequestAt,
      completedAt: null,
    });
  });
});
