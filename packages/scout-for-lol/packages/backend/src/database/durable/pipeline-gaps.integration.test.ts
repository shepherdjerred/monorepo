import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { ReceiptKindSchema } from "@scout-for-lol/domain/match-processing/states.ts";
import {
  countUnmintedLivePostmatchMatches,
  observationLag,
  oldestReadyNotificationIntentAt,
} from "#src/database/durable/pipeline-gaps.ts";
import {
  HOUR_MS,
  MINUTE_MS,
  clearGapTables,
  seedIntent,
  seedOwedMatch,
  seedReceipt,
  seedRecoveryBatch,
  type OwedMatch,
} from "#src/database/durable/pipeline-gaps.test-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testPuuid } from "#src/testing/test-ids.ts";

/**
 * The gap reads against a real Postgres.
 *
 * Each is raw SQL whose whole value is its predicate: a gauge built on a query
 * that matched too much pages on healthy traffic, and one that matched too
 * little is the silence the prod outage fell through. So every exclusion is
 * pinned by a row that it, and only it, keeps out.
 */

const { prisma } = createTestDatabase("durable-pipeline-gaps");

afterAll(async () => {
  await prisma.$disconnect();
});

const NOW = Date.now();
const RENDER_RECEIPT = ReceiptKindSchema.parse(
  "v2-notification-render-postmatch",
);

beforeEach(async () => {
  await clearGapTables(prisma);
});

function owed(matchId: string, overrides: Partial<OwedMatch> = {}): OwedMatch {
  return {
    matchId,
    observedAt: new Date(NOW - 2 * HOUR_MS),
    completedAt: new Date(NOW - HOUR_MS),
    ...overrides,
  };
}

async function unminted(): Promise<number> {
  return await countUnmintedLivePostmatchMatches(prisma, {
    renderReceiptKind: RENDER_RECEIPT,
    observedSince: new Date(NOW - 6 * HOUR_MS),
    settledBefore: new Date(NOW - 15 * MINUTE_MS),
  });
}

describe("countUnmintedLivePostmatchMatches", () => {
  test("counts a finished live V2 match that is owed a report and has none", async () => {
    await seedOwedMatch(prisma, owed("NA1_9301"));
    await seedOwedMatch(prisma, owed("NA1_9302"));
    expect(await unminted()).toBe(2);
  });

  test("does not count a match whose postmatch intent was minted", async () => {
    await seedOwedMatch(prisma, owed("NA1_9311"));
    await seedIntent(prisma, {
      key: "postmatch:NA1_9311",
      matchId: "NA1_9311",
      state: "pending",
      createdAt: new Date(NOW - HOUR_MS),
    });
    expect(await unminted()).toBe(0);
  });

  test("a prematch intent is not a report", async () => {
    await seedOwedMatch(prisma, owed("NA1_9312"));
    await seedIntent(prisma, {
      key: "prematch:NA1_9312",
      matchId: "NA1_9312",
      state: "pending",
      kind: "prematch",
      createdAt: new Date(NOW - HOUR_MS),
    });
    expect(await unminted()).toBe(1);
  });

  test("does not count a match whose cursors have only partly advanced", async () => {
    // The core advances accounts one at a time. A match with any account
    // still unadvanced is mid-run, and the last advance time of the others
    // says nothing about whether the mint has happened.
    await seedOwedMatch(prisma, owed("NA1_9314"));
    await prisma.matchTrackedAccount.create({
      data: {
        riotMatchId: "NA1_9314",
        puuid: testPuuid("NA1_9314-second"),
        cursorAdvancedAt: null,
      },
    });
    expect(await unminted()).toBe(0);
  });

  test("does not count a match the silent backfill has rendered", async () => {
    // The backfill mints no intent on purpose; its render receipt is the only
    // trace, and without this exclusion a remediated incident keeps paging.
    await seedOwedMatch(prisma, owed("NA1_9313"));
    await seedReceipt(prisma, { matchId: "NA1_9313", kind: RENDER_RECEIPT });
    expect(await unminted()).toBe(0);
  });

  test.each([
    ["an ARCHIVE_ONLY match", { policy: "ARCHIVE_ONLY" }],
    ["a v1-owned match", { owner: "LEGACY_V1" }],
    ["a silent-backfill match", { deliveryMode: "silent-backfill" }],
    ["a match whose core is still running", { completedAt: null }],
    [
      "a match that finished inside the grace",
      { completedAt: new Date(NOW - 5 * MINUTE_MS) },
    ],
    [
      "a match observed before the window",
      {
        observedAt: new Date(NOW - 7 * HOUR_MS),
        completedAt: new Date(NOW - 6.5 * HOUR_MS),
      },
    ],
    ["a match nobody subscribes to", { subscription: null }],
    [
      "a match whose only subscription is muted",
      { subscription: { isMuted: true } },
    ],
    [
      "a match whose only subscription is queue-filtered",
      {
        subscription: {
          filters: JSON.stringify({
            filters: [{ type: "queue", queues: ["solo"] }],
          }),
        },
      },
    ],
    [
      "a match whose subscription was created after it finished",
      { subscription: { createdTime: new Date(NOW - 30 * MINUTE_MS) } },
    ],
  ] satisfies [string, Partial<OwedMatch>][])(
    "does not count %s",
    async (_label, overrides) => {
      await seedOwedMatch(prisma, owed("NA1_9320", overrides));
      expect(await unminted()).toBe(0);
    },
  );
});

describe("oldestReadyNotificationIntentAt", () => {
  test("is null when nothing is ready", async () => {
    await seedIntent(prisma, {
      key: "postmatch:NA1_9401",
      matchId: "NA1_9401",
      state: "pending",
      createdAt: new Date(NOW - 5 * HOUR_MS),
    });
    expect(await oldestReadyNotificationIntentAt(prisma)).toBeNull();
  });

  test("is the mint time of the longest-waiting ready intent", async () => {
    const oldest = new Date(NOW - 2 * HOUR_MS);
    await seedIntent(prisma, {
      key: "postmatch:NA1_9402",
      matchId: "NA1_9402",
      state: "ready",
      createdAt: new Date(NOW - 10 * MINUTE_MS),
    });
    await seedIntent(prisma, {
      key: "postmatch:NA1_9403",
      matchId: "NA1_9403",
      state: "ready",
      createdAt: oldest,
    });
    expect(await oldestReadyNotificationIntentAt(prisma)).toEqual(oldest);
  });

  test("ignores a ready intent a recovery batch is deliberately holding", async () => {
    // `no-external` holds everything; it is waiting on an operator by design.
    await seedRecoveryBatch(prisma, {
      id: "batch-held",
      policy: "no-external",
    });
    await seedIntent(prisma, {
      key: "postmatch:NA1_9404",
      matchId: "NA1_9404",
      state: "ready",
      createdAt: new Date(NOW - 5 * HOUR_MS),
      recoveryBatchId: "batch-held",
    });
    // `normal` holds nothing, so its intent is stuck like any other.
    const released = new Date(NOW - HOUR_MS);
    await seedRecoveryBatch(prisma, { id: "batch-normal", policy: "normal" });
    await seedIntent(prisma, {
      key: "postmatch:NA1_9405",
      matchId: "NA1_9405",
      state: "ready",
      createdAt: released,
      recoveryBatchId: "batch-normal",
    });
    expect(await oldestReadyNotificationIntentAt(prisma)).toEqual(released);
  });
});

describe("observationLag", () => {
  const since = new Date(NOW - 2 * HOUR_MS);

  test("reads zero, with zero observations, for an empty window", async () => {
    expect(await observationLag(prisma, { observedSince: since })).toEqual({
      observations: 0,
      p90Seconds: 0,
      maxSeconds: 0,
    });
  });

  test("reports the p90 and max of observation minus game start", async () => {
    // Ten live observations, lagged 10..100 minutes after game start.
    for (let index = 1; index <= 10; index += 1) {
      const observedAt = new Date(NOW - 30 * MINUTE_MS);
      await seedOwedMatch(prisma, {
        matchId: `NA1_95${String(index).padStart(2, "0")}`,
        observedAt,
        completedAt: observedAt,
        gameCreatedAt: new Date(observedAt.getTime() - index * 10 * MINUTE_MS),
        subscription: null,
      });
    }
    const lag = await observationLag(prisma, { observedSince: since });
    expect(lag.observations).toBe(10);
    // percentile_cont interpolates: 0.9 of the way from 10 to 100 minutes.
    expect(lag.p90Seconds).toBeCloseTo(91 * 60, 3);
    expect(lag.maxSeconds).toBeCloseTo(100 * 60, 3);
  });

  const recent = new Date(NOW - 30 * MINUTE_MS);
  test.each<[string, Partial<OwedMatch>]>([
    [
      "a silent backfill, which is late on purpose",
      { deliveryMode: "silent-backfill" },
    ],
    [
      "an ARCHIVE_ONLY match, which is never reported",
      { policy: "ARCHIVE_ONLY" },
    ],
    [
      "an observation before the window",
      { observedAt: new Date(NOW - 3 * HOUR_MS) },
    ],
  ])("leaves out %s", async (_label, overrides) => {
    const observedAt = overrides.observedAt ?? recent;
    await seedOwedMatch(prisma, {
      matchId: "NA1_9601",
      completedAt: observedAt,
      gameCreatedAt: new Date(observedAt.getTime() - 10 * HOUR_MS),
      subscription: null,
      ...overrides,
      observedAt,
    });
    const lag = await observationLag(prisma, { observedSince: since });
    expect(lag.observations).toBe(0);
  });
});
