import { afterAll, describe, expect, test } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationAttemptNonceSchema,
  NotificationIntentSchema,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  beginSend,
  confirmDelivered,
  expire,
  markReady,
  operatorResolveUnknown,
  recordFailure,
  recordUnknownDelivery,
  suppressStale,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import {
  getIntent,
  transitionIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";

const { prisma } = createTestDatabase("durable-intent-repository");

afterAll(async () => {
  await prisma.$disconnect();
});

const MATCH_ID = RiotMatchIdSchema.parse("NA1_9000");
const AT_ISO = "2026-09-07T10:00:00.000Z";
const DEADLINE_ISO = "2026-09-07T11:00:00.000Z";
const STARTED_AT = IsoInstantSchema.parse("2026-09-07T10:30:00.000Z");
const DELIVERED_AT = IsoInstantSchema.parse("2026-09-07T10:31:00.000Z");
const OBSERVED_AT = IsoInstantSchema.parse("2026-09-07T10:32:00.000Z");
const AFTER_DEADLINE = IsoInstantSchema.parse("2026-09-07T12:00:00.000Z");
const NONCE_A = NotificationAttemptNonceSchema.parse("nonce-a");
const NONCE_B = NotificationAttemptNonceSchema.parse("nonce-b");

function intent(
  key: string,
  target?: Record<string, unknown>,
): MatchNotificationIntentRecord {
  return {
    matchId: MATCH_ID,
    intent: NotificationIntentSchema.parse({
      key,
      target: target ?? { kind: "channel", channelId: "300000000000000001" },
      freshnessDeadline: DEADLINE_ISO,
      createdAt: AT_ISO,
      attemptCount: 0,
      state: { kind: "pending" },
    }),
  };
}

describe("upsertIntent", () => {
  test("applies once, answers an identical retry, and conflicts on drift", async () => {
    const record = intent("upsert-1");
    expect(await upsertIntent(prisma, record)).toEqual({ outcome: "applied" });
    expect(await upsertIntent(prisma, record)).toEqual({
      outcome: "already-applied",
    });

    const drifted = intent("upsert-1", {
      kind: "dm",
      accountId: "200000000000000001",
    });
    expect(await upsertIntent(prisma, drifted)).toEqual({
      outcome: "conflict",
      reason: "intent-differs",
    });
  });
});

describe("transitionIntent", () => {
  test("walks pending -> ready -> sending -> delivered through guarded updates", async () => {
    await upsertIntent(prisma, intent("walk-1"));
    const key = intent("walk-1").intent.key;

    const readied = await transitionIntent(prisma, {
      intentKey: key,
      transition: markReady,
    });
    expect(readied.outcome).toBe("applied");
    const sending = await transitionIntent(prisma, {
      intentKey: key,
      transition: (value) =>
        beginSend(value, { attemptNonce: NONCE_A, startedAt: STARTED_AT }),
    });
    expect(sending.outcome).toBe("applied");
    const delivered = await transitionIntent(prisma, {
      intentKey: key,
      transition: (value) =>
        confirmDelivered(value, {
          attemptNonce: NONCE_A,
          deliveredAt: DELIVERED_AT,
        }),
    });
    expect(delivered.outcome).toBe("applied");

    const stored = await getIntent(prisma, { intentKey: key });
    expect(stored?.intent.state).toEqual({
      kind: "delivered",
      deliveredAt: DELIVERED_AT,
    });
    expect(stored?.intent.attemptCount).toBe(1);
  });

  test("a retryable failure returns the intent to ready and persists the failure", async () => {
    await upsertIntent(prisma, intent("fail-1"));
    const key = intent("fail-1").intent.key;
    await transitionIntent(prisma, { intentKey: key, transition: markReady });
    await transitionIntent(prisma, {
      intentKey: key,
      transition: (value) =>
        beginSend(value, { attemptNonce: NONCE_A, startedAt: STARTED_AT }),
    });
    const failed = await transitionIntent(prisma, {
      intentKey: key,
      transition: (value) =>
        recordFailure(value, {
          attemptNonce: NONCE_A,
          failure: { classification: "retryable", reason: "rate-limited" },
        }),
    });
    expect(failed.outcome).toBe("applied");

    const stored = await getIntent(prisma, { intentKey: key });
    expect(stored?.intent.state).toEqual({ kind: "ready" });
    expect(stored?.intent.lastFailure).toEqual({
      classification: "retryable",
      reason: "rate-limited",
    });
  });

  test("an unknown delivery is parked until an operator resolves it", async () => {
    await upsertIntent(prisma, intent("unknown-1"));
    const key = intent("unknown-1").intent.key;
    await transitionIntent(prisma, { intentKey: key, transition: markReady });
    await transitionIntent(prisma, {
      intentKey: key,
      transition: (value) =>
        beginSend(value, { attemptNonce: NONCE_A, startedAt: STARTED_AT }),
    });
    const unknown = await transitionIntent(prisma, {
      intentKey: key,
      transition: (value) =>
        recordUnknownDelivery(value, {
          attemptNonce: NONCE_A,
          observedAt: OBSERVED_AT,
        }),
    });
    expect(unknown.outcome).toBe("applied");

    // Nothing but the operator may move it — even a fresh send attempt.
    expect(
      await transitionIntent(prisma, {
        intentKey: key,
        transition: (value) =>
          beginSend(value, { attemptNonce: NONCE_B, startedAt: STARTED_AT }),
      }),
    ).toEqual({
      outcome: "conflict",
      reason: "unknown-delivery-requires-operator",
    });

    const resolved = await transitionIntent(prisma, {
      intentKey: key,
      transition: (value) =>
        operatorResolveUnknown(value, {
          outcome: "confirmed-unsent",
          attemptNonce: NONCE_A,
        }),
    });
    expect(resolved.outcome).toBe("applied");
    const stored = await getIntent(prisma, { intentKey: key });
    expect(stored?.intent.state).toEqual({ kind: "ready" });
  });

  test("expire moves an undelivered intent to its terminal state", async () => {
    await upsertIntent(prisma, intent("expire-1"));
    const key = intent("expire-1").intent.key;
    const expired = await transitionIntent(prisma, {
      intentKey: key,
      transition: expire,
    });
    expect(expired.outcome).toBe("applied");
    expect(
      await transitionIntent(prisma, { intentKey: key, transition: markReady }),
    ).toEqual({ outcome: "conflict", reason: "terminal-state" });
  });

  test("returns the domain's conflict for an illegal transition", async () => {
    await upsertIntent(prisma, intent("illegal-1"));
    const key = intent("illegal-1").intent.key;
    expect(
      await transitionIntent(prisma, {
        intentKey: key,
        transition: (value) => suppressStale(value, { at: STARTED_AT }),
      }),
    ).toEqual({ outcome: "conflict", reason: "not-stale" });
    expect(
      await transitionIntent(prisma, {
        intentKey: key,
        transition: (value) => suppressStale(value, { at: AFTER_DEADLINE }),
      }),
    ).toEqual(expect.objectContaining({ outcome: "applied" }));
  });

  test("exactly one of two concurrent sends from ready applies", async () => {
    await upsertIntent(prisma, intent("race-1"));
    const key = intent("race-1").intent.key;
    await transitionIntent(prisma, { intentKey: key, transition: markReady });

    const outcomes = await Promise.all([
      transitionIntent(prisma, {
        intentKey: key,
        transition: (value) =>
          beginSend(value, { attemptNonce: NONCE_A, startedAt: STARTED_AT }),
      }),
      transitionIntent(prisma, {
        intentKey: key,
        transition: (value) =>
          beginSend(value, { attemptNonce: NONCE_B, startedAt: STARTED_AT }),
      }),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "applied",
      "conflict",
    ]);
    const conflict = outcomes.find((result) => result.outcome === "conflict");
    expect(conflict).toEqual({
      outcome: "conflict",
      reason: "already-sending",
    });

    const stored = await getIntent(prisma, { intentKey: key });
    expect(stored?.intent.state.kind).toBe("sending");
    expect(stored?.intent.attemptCount).toBe(1);
  });

  test("two concurrent identical markReady calls settle as applied plus already-applied", async () => {
    await upsertIntent(prisma, intent("race-2"));
    const key = intent("race-2").intent.key;
    const outcomes = await Promise.all([
      transitionIntent(prisma, { intentKey: key, transition: markReady }),
      transitionIntent(prisma, { intentKey: key, transition: markReady }),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "already-applied",
      "applied",
    ]);
  });

  test("transitioning an intent that was never upserted fails loudly", async () => {
    await expect(
      transitionIntent(prisma, {
        intentKey: intent("ghost-1").intent.key,
        transition: markReady,
      }),
    ).rejects.toThrow(/never upserted/);
  });
});
