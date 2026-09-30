import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  IsoInstantSchema,
  type NotificationIntentKey,
} from "@scout-for-lol/domain/identity/brands.ts";
import { NotificationAttemptNonceSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  beginSend,
  recordUnknownDelivery,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId, testPuuid } from "#src/testing/test-ids.ts";
import {
  getIntent,
  transitionIntent,
} from "#src/database/durable/intent-repository.ts";
import { oldestReadyNotificationIntentAt } from "#src/database/durable/pipeline-gaps.ts";
import {
  retireOrphanedNotificationIntents,
  type NotificationIntentRetirementCounts,
} from "#src/durable/match/intent-retirement.ts";
import {
  raceFirstIntentUpdate,
  retiredCount,
  seedChannelIntent,
  seedSubscription,
  seedTrackedAccount,
} from "#src/durable/match/intent-retirement.test-fixtures.ts";
import { scoutDurableNotificationIntentsRetired } from "#src/metrics/durable-pipeline.ts";

/**
 * The sweep's half of retirement, against real rows.
 *
 * Mutation proofs, one per guard:
 *
 * - Make `retireOrphaned`'s `sending` arm apply like `pending`/`ready`:
 *   "a beginSend that commits between the read and the write wins" fails,
 *   because the re-read after the guard miss would retire the attempt.
 * - Drop the `state` filter from `listRetirableIntents`: "never selects an
 *   attempted intent" fails on `selected`.
 * - Drop the `freshnessDeadline` filter: "leaves overdue intents to expiry"
 *   fails on `selected`.
 * - Drop the `kind` filter: "never judges a settlement by subscriptions"
 *   fails on `selected`.
 * - Replace the tracked-account `some` clause with the channel-only where:
 *   "a subscription to someone else in the channel is not this match's
 *   audience" keeps the intent ready.
 */
const { prisma } = createTestDatabase("durable-intent-retirement");

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.matchTrackedAccount.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  scoutDurableNotificationIntentsRetired.reset();
});

const MATCH_ID = "NA1_9300";
const CHANNEL = testChannelId("9300");
const OTHER_CHANNEL = testChannelId("9301");
const PUUID = testPuuid("9300");
const NOW = new Date("2026-09-21T00:00:00.000Z");
const NONCE = NotificationAttemptNonceSchema.parse("retirement-nonce");
const STARTED_AT = IsoInstantSchema.parse("2026-09-20T12:00:00.000Z");
const OBSERVED_AT = IsoInstantSchema.parse("2026-09-20T12:01:00.000Z");
const RETIRED = { kind: "suppressed", reason: "subscription-deleted" };

async function stateOf(key: NotificationIntentKey): Promise<unknown> {
  const stored = await getIntent(prisma, { intentKey: key });
  if (stored === null) throw new Error(`intent ${key} vanished`);
  return stored.intent.state;
}

async function sweep(
  db: typeof prisma = prisma,
): Promise<NotificationIntentRetirementCounts> {
  return await retireOrphanedNotificationIntents(db, { now: NOW, limit: 50 });
}

async function readyIntent(name: string): Promise<NotificationIntentKey> {
  return await seedChannelIntent(prisma, {
    name,
    matchId: MATCH_ID,
    channelId: CHANNEL,
    state: "ready",
  });
}

async function beginAttempt(key: NotificationIntentKey): Promise<void> {
  const begun = await transitionIntent(prisma, {
    intentKey: key,
    transition: (intent) =>
      beginSend(intent, { attemptNonce: NONCE, startedAt: STARTED_AT }),
  });
  expect(begun.outcome).toBe("applied");
}

describe("retireOrphanedNotificationIntents: whose audience is gone", () => {
  test("retires pending and ready intents whose subscription was deleted", async () => {
    const { subscriptionId } = await seedSubscription(prisma, {
      channelId: CHANNEL,
      puuid: PUUID,
      alias: "deleted",
    });
    await seedTrackedAccount(prisma, { matchId: MATCH_ID, puuid: PUUID });
    const pending = await seedChannelIntent(prisma, {
      name: "pending",
      matchId: MATCH_ID,
      channelId: CHANNEL,
      state: "pending",
    });
    const ready = await readyIntent("ready");
    expect(await oldestReadyNotificationIntentAt(prisma)).not.toBeNull();

    await prisma.subscription.delete({ where: { id: subscriptionId } });
    const counts = await sweep();

    expect(counts).toEqual({
      selected: 2,
      retired: 2,
      alreadyRetired: 0,
      conflicts: {},
      batchFilled: false,
    });
    expect(await stateOf(pending)).toEqual(RETIRED);
    expect(await stateOf(ready)).toEqual(RETIRED);
    // The ready-backlog alert's read no longer sees the retired intent.
    expect(await oldestReadyNotificationIntentAt(prisma)).toBeNull();
    expect(await retiredCount("subscription-deleted", "sweep")).toBe(2);
  });

  test("leaves an intent whose subscription stands", async () => {
    await seedSubscription(prisma, {
      channelId: CHANNEL,
      puuid: PUUID,
      alias: "live",
    });
    await seedTrackedAccount(prisma, { matchId: MATCH_ID, puuid: PUUID });
    const ready = await readyIntent("live");

    const counts = await sweep();

    expect(counts).toMatchObject({ selected: 1, retired: 0 });
    expect(await stateOf(ready)).toEqual({ kind: "ready" });
    expect(await retiredCount("subscription-deleted", "sweep")).toBe(0);
  });

  test("a muted subscription is not a deleted one", async () => {
    const { subscriptionId } = await seedSubscription(prisma, {
      channelId: CHANNEL,
      puuid: PUUID,
      alias: "muted",
    });
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { isMuted: true },
    });
    const ready = await readyIntent("muted");

    const counts = await sweep();

    expect(counts.retired).toBe(0);
    expect(await stateOf(ready)).toEqual({ kind: "ready" });
  });

  test("a subscription to someone else in the channel is not this match's audience", async () => {
    // The tracked account was removed: the channel still follows a player,
    // but not one who was in this game.
    await seedSubscription(prisma, {
      channelId: CHANNEL,
      puuid: testPuuid("9399"),
      alias: "someone-else",
    });
    await seedTrackedAccount(prisma, { matchId: MATCH_ID, puuid: PUUID });
    const ready = await readyIntent("someone-else");

    const counts = await sweep();

    expect(counts.retired).toBe(1);
    expect(await stateOf(ready)).toEqual(RETIRED);
  });

  test("a subscription in another channel does not keep this one's audience", async () => {
    await seedSubscription(prisma, {
      channelId: OTHER_CHANNEL,
      puuid: PUUID,
      alias: "other-channel",
    });
    await seedTrackedAccount(prisma, { matchId: MATCH_ID, puuid: PUUID });
    const ready = await readyIntent("other-channel");

    const counts = await sweep();

    expect(counts.retired).toBe(1);
    expect(await stateOf(ready)).toEqual(RETIRED);
  });

  test("with no tracked accounts yet, any subscription in the channel stands", async () => {
    await seedSubscription(prisma, {
      channelId: CHANNEL,
      puuid: testPuuid("9398"),
      alias: "prematch",
    });
    const pending = await seedChannelIntent(prisma, {
      name: "prematch",
      kind: "prematch",
      matchId: MATCH_ID,
      channelId: CHANNEL,
      state: "pending",
    });

    const first = await sweep();
    expect(first.retired).toBe(0);
    expect(await stateOf(pending)).toEqual({ kind: "pending" });

    await prisma.subscription.deleteMany();
    const second = await sweep();
    expect(second.retired).toBe(1);
    expect(await stateOf(pending)).toEqual(RETIRED);
  });
});

describe("retireOrphanedNotificationIntents: what it never touches", () => {
  test("never judges a settlement by subscriptions", async () => {
    const settlement = await seedChannelIntent(prisma, {
      name: "settlement",
      kind: "settlement",
      matchId: MATCH_ID,
      channelId: CHANNEL,
      state: "ready",
    });

    const counts = await sweep();

    expect(counts.selected).toBe(0);
    expect(await stateOf(settlement)).toEqual({ kind: "ready" });
  });

  test("leaves overdue intents to expiry", async () => {
    const overdue = await seedChannelIntent(prisma, {
      name: "overdue",
      matchId: MATCH_ID,
      channelId: CHANNEL,
      state: "ready",
      freshnessDeadline: "2026-09-20T23:00:00.000Z",
    });

    const counts = await sweep();

    expect(counts.selected).toBe(0);
    expect(await stateOf(overdue)).toEqual({ kind: "ready" });
  });

  test("never selects an attempted intent", async () => {
    const sending = await readyIntent("sending");
    await beginAttempt(sending);
    const unknown = await readyIntent("unknown");
    await beginAttempt(unknown);
    await transitionIntent(prisma, {
      intentKey: unknown,
      transition: (intent) =>
        recordUnknownDelivery(intent, {
          attemptNonce: NONCE,
          observedAt: OBSERVED_AT,
        }),
    });
    const before = await prisma.matchNotificationIntent.findMany({
      orderBy: { intentKey: "asc" },
    });

    const counts = await sweep();

    expect(counts).toEqual({
      selected: 0,
      retired: 0,
      alreadyRetired: 0,
      conflicts: {},
      batchFilled: false,
    });
    const after = await prisma.matchNotificationIntent.findMany({
      orderBy: { intentKey: "asc" },
    });
    expect(after).toEqual(before);
  });

  test("a rerun is idempotent", async () => {
    const ready = await readyIntent("rerun");

    const first = await sweep();
    expect(first.retired).toBe(1);
    const afterFirst = await getIntent(prisma, { intentKey: ready });
    const second = await sweep();
    expect(second).toMatchObject({ selected: 0, retired: 0 });
    expect(await getIntent(prisma, { intentKey: ready })).toEqual(afterFirst);
    expect(await retiredCount("subscription-deleted", "sweep")).toBe(1);
  });

  test("a beginSend that commits between the read and the write wins", async () => {
    const key = await readyIntent("raced");
    // The sweep has already read the row as `ready` and found its audience
    // gone when a sender commits its attempt. The guard must miss and the
    // re-read must answer `send-in-flight`.
    const racing = raceFirstIntentUpdate(prisma, async () => {
      await beginAttempt(key);
    });

    const counts = await sweep(racing.db);

    expect(racing.raced()).toBe(true);
    expect(counts).toMatchObject({
      selected: 1,
      retired: 0,
      conflicts: { "send-in-flight": 1 },
    });
    expect(await stateOf(key)).toEqual({
      kind: "sending",
      attemptNonce: NONCE,
      startedAt: STARTED_AT,
    });
    expect(await retiredCount("subscription-deleted", "sweep")).toBe(0);
  });
});
