import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  MatchIdSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { bucksTestPuuid } from "#src/testing/bucks-fixtures.ts";
import { freezeMvpTestRoster } from "#src/testing/mvp-votes-fixtures.ts";
import {
  reconcileMvpTallyRefresh,
  reconcilePendingMvpTallyRefreshes,
} from "#src/mvp-votes/tally-reconciliation.ts";
import { upsertMatchMvpVote } from "#src/mvp-votes/vote.ts";

const { prisma: db } = createTestDatabase("mvp-tally-reconciliation");
const matchId = MatchIdSchema.parse("NA1_5000000099");
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

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.matchMvpTallyRefresh.deleteMany();
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
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const firstEditGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let visibleRevision = 0;
    const first = reconcileMvpTallyRefresh(key, db, async () => {
      firstStarted();
      await firstEditGate;
      visibleRevision = 1;
      return true;
    });
    await firstStartedPromise;
    await vote(2);
    await db.matchMvpTallyRefresh.update({
      where,
      data: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) },
    });
    await reconcileMvpTallyRefresh(key, db, async () => {
      visibleRevision = 2;
      return true;
    });
    releaseFirst();
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

  test("requeues after a stale multi-message edit partially fails", async () => {
    await vote(1);
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const firstEditGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = reconcileMvpTallyRefresh(key, db, async () => {
      firstStarted();
      await firstEditGate;
      throw new Error("A later Discord target failed");
    });
    await firstStartedPromise;
    await vote(2);
    await db.matchMvpTallyRefresh.update({
      where,
      data: { leaseUntil: new Date(0), nextAttemptAt: new Date(0) },
    });
    await reconcileMvpTallyRefresh(key, db, async () => true);
    releaseFirst();
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
      lastErrorCode: "discord-edit-failed",
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

  test("closes a report that remains unavailable after the delivery window", async () => {
    await vote(1);
    await db.matchMvpTallyRefresh.update({
      where,
      data: { requestedAt: new Date(0) },
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
