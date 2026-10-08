import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data/index.ts";
import { VOID_GRACE_MS } from "#src/betting/constants.ts";
import { bucksTestRoster } from "#src/testing/bucks-fixtures.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

/**
 * The stale-pool void and its announcement, against a real database.
 *
 * The void is irreversible: a voided pool is no longer stale, so no later
 * pass would announce it. These tests prove the reply-target lookup runs
 * before each match's void, so a failing lookup leaves that match's pools
 * untouched for the next pass, and that one failing match cannot stop
 * another match's refunds. Discord sends are stubbed; the pool rows are real.
 */

const { prisma } = createTestDatabase("void-stale-announce");

vi.doMock("#src/database/index.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  prisma,
}));

const stubs = vi.hoisted(() => ({
  postmatchReplyTargets: vi.fn(),
  announceSettlements: vi.fn(),
  refreshClosedBucksMessages: vi.fn(),
}));
vi.mock("#src/temporal/notification/settlement-notification.ts", () => ({
  postmatchReplyTargets: stubs.postmatchReplyTargets,
}));
vi.mock("#src/betting/notify/announce.ts", () => ({
  announceSettlements: stubs.announceSettlements,
}));
vi.mock("#src/betting/notify/message-refresh.ts", () => ({
  refreshClosedBucksMessages: stubs.refreshClosedBucksMessages,
}));

const { voidStaleAndAnnounce } =
  await import("#src/league/tasks/postmatch/void-stale-announce.ts");

const MATCH_ID = RiotMatchIdSchema.parse("NA1_7701");
const HEALTHY_MATCH_ID = RiotMatchIdSchema.parse("NA1_7702");
const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const CHANNEL = "300000000000007701";
const REPORT_MESSAGE = "400000000000007701";

async function makeStalePool(matchId: RiotMatchId = MATCH_ID) {
  const closesAt = new Date(Date.now() - VOID_GRACE_MS - 60_000);
  return await prisma.bucksMatchPool.create({
    data: {
      matchId,
      serverId: SERVER,
      detectedAt: new Date(closesAt.getTime() - 600_000),
      closesAt,
      queueType: "flex",
      roster: JSON.stringify({ participants: bucksTestRoster() }),
      poolState: "open",
    },
  });
}

async function poolState(id: number) {
  return await prisma.bucksMatchPool.findUniqueOrThrow({
    where: { id },
    select: { poolState: true, settledAt: true },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  stubs.announceSettlements.mockResolvedValue(undefined);
  stubs.refreshClosedBucksMessages.mockResolvedValue(undefined);
  await prisma.bucksMatchPool.deleteMany({});
});

describe("voidStaleAndAnnounce", () => {
  test("leaves the pools un-voided when the reply-target lookup fails", async () => {
    const pool = await makeStalePool();
    stubs.postmatchReplyTargets.mockRejectedValue(
      new Error("intent read timed out"),
    );

    const failure = await voidStaleAndAnnounce().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect(String(failure)).toContain(MATCH_ID);
    expect(
      failure instanceof AggregateError ? String(failure.errors[0]) : "",
    ).toContain("intent read timed out");

    // Nothing irreversible happened, so the next pass finds the pool stale
    // and retries the whole step.
    expect(await poolState(pool.id)).toEqual({
      poolState: "open",
      settledAt: null,
    });
    expect(stubs.refreshClosedBucksMessages).not.toHaveBeenCalled();
    expect(stubs.announceSettlements).not.toHaveBeenCalled();
  });

  test("voids and announces a healthy match while another match's lookup fails", async () => {
    const broken = await makeStalePool(MATCH_ID);
    const healthy = await makeStalePool(HEALTHY_MATCH_ID);
    stubs.postmatchReplyTargets.mockImplementation((matchId: RiotMatchId) =>
      matchId === MATCH_ID
        ? Promise.reject(new Error("malformed delivered intent"))
        : Promise.resolve(new Map([[CHANNEL, REPORT_MESSAGE]])),
    );

    // The corrupt match still fails the step loudly, by name.
    await expect(voidStaleAndAnnounce()).rejects.toThrow(MATCH_ID);

    expect(await poolState(broken.id)).toEqual({
      poolState: "open",
      settledAt: null,
    });
    const healed = await poolState(healthy.id);
    expect(healed.poolState).not.toBe("open");
    expect(stubs.announceSettlements).toHaveBeenCalledTimes(1);
    expect(stubs.announceSettlements).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: HEALTHY_MATCH_ID,
        postmatchMessageIds: new Map([[CHANNEL, REPORT_MESSAGE]]),
      }),
    );
  });

  test("retries cleanly on the next pass and replies to the report", async () => {
    const pool = await makeStalePool();
    stubs.postmatchReplyTargets.mockRejectedValueOnce(
      new Error("intent read timed out"),
    );
    await expect(voidStaleAndAnnounce()).rejects.toThrow();
    stubs.postmatchReplyTargets.mockResolvedValue(
      new Map([[CHANNEL, REPORT_MESSAGE]]),
    );

    await voidStaleAndAnnounce();

    const after = await poolState(pool.id);
    expect(after.poolState).not.toBe("open");
    expect(stubs.postmatchReplyTargets).toHaveBeenCalledWith(MATCH_ID);
    expect(stubs.announceSettlements).toHaveBeenCalledTimes(1);
    expect(stubs.announceSettlements).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: MATCH_ID,
        postmatchMessageIds: new Map([[CHANNEL, REPORT_MESSAGE]]),
      }),
    );
  });
});
