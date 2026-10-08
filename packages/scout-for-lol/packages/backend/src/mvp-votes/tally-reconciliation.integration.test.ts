import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { NotificationIntentSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { upsertIntent } from "#src/database/durable/intent-repository.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { bucksTestPuuid } from "#src/testing/bucks-fixtures.ts";
import { freezeMvpTestRoster } from "#src/testing/mvp-votes-fixtures.ts";
import {
  reconcileMvpTallyRefresh,
  reconcilePendingMvpTallyRefreshes,
} from "#src/mvp-votes/tally-reconciliation.ts";
import { upsertMatchMvpVote } from "#src/mvp-votes/vote.ts";

const { prisma: db } = createTestDatabase("mvp-tally-reconciliation");
const matchId = RiotMatchIdSchema.parse("NA1_5000000099");
const serverId = DiscordGuildIdSchema.parse("1337623164146155593");
const voterDiscordId = DiscordAccountIdSchema.parse("160509172704739328");
const key = { matchId, serverId };
const where = { matchId_serverId: key };

async function vote(nomineeIndex: number) {
  return await upsertMatchMvpVote(
    {
      ...key,
      voterDiscordId,
      category: "ally",
      nomineeIndex,
      voterPuuid: bucksTestPuuid(0),
      voterTeamId: 100,
    },
    db,
  );
}

async function expireClaimAfterAnotherVote(): Promise<void> {
  await vote(2);
  await db.matchMvpTallyRefresh.update({
    where,
    data: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) },
  });
}

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.matchMvpTallyRefresh.deleteMany();
  await db.matchNotificationIntent.deleteMany({
    where: { riotMatchId: matchId },
  });
  await db.matchMvpVote.deleteMany();
  await db.matchMvpContest.deleteMany();
  await db.matchMvpContest.create({
    data: { matchId, roster: freezeMvpTestRoster(matchId) },
  });
});

describe("durable MVP tally refresh", () => {
  test("coalesces votes and marks the edited revision applied", async () => {
    await vote(1);
    await vote(2);
    const refresh = vi.fn(async () => true);
    await reconcileMvpTallyRefresh(key, db, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      desiredRevision: 2,
      appliedRevision: 2,
      pending: false,
      leaseToken: null,
    });
  });

  test("preserves a vote committed during an edit for the next sweep", async () => {
    await vote(1);
    await reconcileMvpTallyRefresh(key, db, async () => {
      await vote(2);
      return true;
    });
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      desiredRevision: 2,
      appliedRevision: 1,
      pending: true,
    });
    await reconcilePendingMvpTallyRefreshes(db, async () => true);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({ appliedRevision: 2, pending: false });
  });

  test("requeues the current tally when a stale edit finishes after losing its lease", async () => {
    await vote(1);
    const started = Promise.withResolvers<boolean>();
    const editGate = Promise.withResolvers<boolean>();
    let visibleRevision = 0;
    const first = reconcileMvpTallyRefresh(key, db, async () => {
      started.resolve(true);
      await editGate.promise;
      visibleRevision = 1;
      return true;
    });
    await started.promise;
    await expireClaimAfterAnotherVote();
    await reconcileMvpTallyRefresh(key, db, async () => {
      visibleRevision = 2;
      return true;
    });
    editGate.resolve(true);
    await first;
    expect(visibleRevision).toBe(1);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({ desiredRevision: 2, pending: true });
    await reconcilePendingMvpTallyRefreshes(db, async () => {
      visibleRevision = 2;
      return true;
    });
    expect(visibleRevision).toBe(2);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({ appliedRevision: 2, pending: false });
  });
});

describe("MVP tally lease recovery", () => {
  test("a newer worker cannot clear a stale worker's late requeue", async () => {
    await vote(1);
    const firstStarted = Promise.withResolvers<boolean>();
    const releaseFirst = Promise.withResolvers<boolean>();
    const secondStarted = Promise.withResolvers<boolean>();
    const releaseSecond = Promise.withResolvers<boolean>();
    let visibleRevision = 0;
    const first = reconcileMvpTallyRefresh(key, db, async () => {
      firstStarted.resolve(true);
      await releaseFirst.promise;
      visibleRevision = 1;
      return true;
    });
    await firstStarted.promise;
    await expireClaimAfterAnotherVote();

    const second = reconcileMvpTallyRefresh(key, db, async () => {
      visibleRevision = 2;
      secondStarted.resolve(true);
      await releaseSecond.promise;
      return true;
    });
    await secondStarted.promise;
    releaseFirst.resolve(true);
    await first;
    expect(visibleRevision).toBe(1);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      desiredRevision: 2,
      pending: true,
      requeueGeneration: 1,
    });

    releaseSecond.resolve(true);
    await second;
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      desiredRevision: 2,
      appliedRevision: 2,
      pending: true,
      requeueGeneration: 1,
    });
    await reconcilePendingMvpTallyRefreshes(db, async () => {
      visibleRevision = 2;
      return true;
    });
    expect(visibleRevision).toBe(2);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({ pending: false, appliedRevision: 2 });
  });

  test("requeues after a stale multi-message edit partially fails", async () => {
    await vote(1);
    const started = Promise.withResolvers<boolean>();
    const editGate = Promise.withResolvers<boolean>();
    const first = reconcileMvpTallyRefresh(key, db, async () => {
      started.resolve(true);
      await editGate.promise;
      throw new Error("A later Discord target failed");
    });
    await started.promise;
    await expireClaimAfterAnotherVote();
    await reconcileMvpTallyRefresh(key, db, async () => true);
    editGate.resolve(true);
    await first;
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({ desiredRevision: 2, pending: true });
  });

  test("retries a failed edit and recovers an expired worker lease", async () => {
    await vote(1);
    await reconcileMvpTallyRefresh(key, db, async () => {
      throw new Error("Discord unavailable");
    });
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: true,
      lastErrorCode: "discord-edit-unknown",
    });
    await db.matchMvpTallyRefresh.update({
      where,
      data: {
        nextAttemptAt: new Date(0),
        leaseToken: "crashed-worker",
        leaseUntil: new Date(0),
      },
    });
    await reconcilePendingMvpTallyRefreshes(db, async () => true);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      appliedRevision: 1,
      pending: false,
      leaseToken: null,
    });
  });

  test("does not infer a terminal report outcome from elapsed time", async () => {
    await vote(1);
    await db.matchMvpTallyRefresh.update({
      where,
      data: { requestedAt: new Date(0) },
    });
    await reconcileMvpTallyRefresh(key, db, async () => false);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: true,
      lastErrorCode: "awaiting-report",
    });
  });

  test("closes only after postmatch intents record a terminal no-send outcome", async () => {
    await vote(1);
    await upsertIntent(db, {
      matchId: matchId,
      intent: NotificationIntentSchema.parse({
        key: "mvp-no-report",
        kind: "postmatch",
        origin: { kind: "live" },
        target: { kind: "channel", channelId: "300000000000000001" },
        freshnessDeadline: "2026-09-07T11:00:00.000Z",
        createdAt: "2026-09-07T10:00:00.000Z",
        attemptCount: 0,
        state: { kind: "expired" },
      }),
    });
    await reconcileMvpTallyRefresh(key, db, async () => false);
    await expect(
      db.matchMvpTallyRefresh.findUniqueOrThrow({ where }),
    ).resolves.toMatchObject({
      pending: false,
      lastErrorCode: "report-unavailable",
    });
  });
});
