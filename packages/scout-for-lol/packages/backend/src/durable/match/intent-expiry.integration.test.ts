import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type NotificationIntentKey,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationAttemptNonceSchema,
  NotificationIntentSchema,
} from "@scout-for-lol/domain/notifications/intent.ts";
import {
  beginSend,
  markReady,
  recordUnknownDelivery,
} from "@scout-for-lol/domain/notifications/intent-transitions.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  getIntent,
  transitionIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import { expireOverdueNotificationIntents } from "#src/durable/match/intent-expiry.ts";
import { raceFirstIntentUpdate } from "#src/durable/match/intent-retirement.test-fixtures.ts";

const { prisma } = createTestDatabase("durable-intent-expiry");

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.matchNotificationIntent.deleteMany();
});

const MATCH_ID = RiotMatchIdSchema.parse("NA1_9100");
const CREATED_AT = "2026-09-07T09:00:00.000Z";
const PAST_DEADLINE = "2026-09-07T11:00:00.000Z";
const EARLIER_PAST_DEADLINE = "2026-09-07T10:00:00.000Z";
const FUTURE_DEADLINE = "2026-09-07T13:00:00.000Z";
const NOW = new Date("2026-09-07T12:00:00.000Z");
const STARTED_BEFORE_DEADLINE = IsoInstantSchema.parse(
  "2026-09-07T10:30:00.000Z",
);
const OBSERVED_AT = IsoInstantSchema.parse("2026-09-07T10:31:00.000Z");
const NONCE = NotificationAttemptNonceSchema.parse("expiry-nonce");

type SeededState = "pending" | "ready" | "sending" | "unknown-delivery";

/**
 * Seed one intent and walk it to `state` through the ordinary guarded
 * transitions, so every row is one the pipeline could really have written.
 */
async function seed(
  key: string,
  state: SeededState,
  freshnessDeadline: string,
): Promise<NotificationIntentKey> {
  const intent = NotificationIntentSchema.parse({
    key,
    kind: "postmatch",
    origin: { kind: "live" },
    target: { kind: "channel", channelId: "300000000000000001" },
    freshnessDeadline,
    createdAt: CREATED_AT,
    attemptCount: 0,
    state: { kind: "pending" },
  });
  expect(await upsertIntent(prisma, { matchId: MATCH_ID, intent })).toEqual({
    outcome: "applied",
  });
  if (state === "pending") return intent.key;
  await transitionIntent(prisma, {
    intentKey: intent.key,
    transition: markReady,
  });
  if (state === "ready") return intent.key;
  await transitionIntent(prisma, {
    intentKey: intent.key,
    transition: (value) =>
      beginSend(value, {
        attemptNonce: NONCE,
        startedAt: STARTED_BEFORE_DEADLINE,
      }),
  });
  if (state === "sending") return intent.key;
  await transitionIntent(prisma, {
    intentKey: intent.key,
    transition: (value) =>
      recordUnknownDelivery(value, {
        attemptNonce: NONCE,
        observedAt: OBSERVED_AT,
      }),
  });
  return intent.key;
}

async function stateOf(key: NotificationIntentKey): Promise<string> {
  const stored = await getIntent(prisma, { intentKey: key });
  if (stored === null) throw new Error(`intent ${key} vanished`);
  return stored.intent.state.kind;
}

describe("expireOverdueNotificationIntents", () => {
  test("expires past-deadline pending and ready intents", async () => {
    const pending = await seed("overdue-pending", "pending", PAST_DEADLINE);
    const ready = await seed("overdue-ready", "ready", PAST_DEADLINE);

    const counts = await expireOverdueNotificationIntents(prisma, {
      now: NOW,
      limit: 50,
    });

    expect(counts).toEqual({
      selected: 2,
      expired: 2,
      alreadyExpired: 0,
      conflicts: {},
      batchFilled: false,
    });
    expect(await stateOf(pending)).toBe("expired");
    expect(await stateOf(ready)).toBe("expired");
  });

  test("leaves intents whose deadline has not passed", async () => {
    const pending = await seed("fresh-pending", "pending", FUTURE_DEADLINE);
    const ready = await seed("fresh-ready", "ready", FUTURE_DEADLINE);
    // `beginSend` refuses only a start strictly AFTER the deadline, so an
    // intent exactly at it can still be sent and must not be expired.
    const atDeadline = await seed(
      "at-deadline-ready",
      "ready",
      NOW.toISOString(),
    );

    const counts = await expireOverdueNotificationIntents(prisma, {
      now: NOW,
      limit: 50,
    });

    expect(counts.selected).toBe(0);
    expect(counts.expired).toBe(0);
    expect(await stateOf(pending)).toBe("pending");
    expect(await stateOf(ready)).toBe("ready");
    expect(await stateOf(atDeadline)).toBe("ready");
  });

  test("never touches sending or unknown-delivery intents", async () => {
    const sending = await seed("overdue-sending", "sending", PAST_DEADLINE);
    const unknown = await seed(
      "overdue-unknown",
      "unknown-delivery",
      PAST_DEADLINE,
    );
    const before = await prisma.matchNotificationIntent.findMany({
      orderBy: { intentKey: "asc" },
    });

    const counts = await expireOverdueNotificationIntents(prisma, {
      now: NOW,
      limit: 50,
    });

    // Not selected at all, rather than selected and refused by the domain.
    expect(counts).toEqual({
      selected: 0,
      expired: 0,
      alreadyExpired: 0,
      conflicts: {},
      batchFilled: false,
    });
    expect(await stateOf(sending)).toBe("sending");
    expect(await stateOf(unknown)).toBe("unknown-delivery");
    expect(
      await prisma.matchNotificationIntent.findMany({
        orderBy: { intentKey: "asc" },
      }),
    ).toEqual(before);
  });

  test("a rerun is idempotent", async () => {
    const ready = await seed("rerun-ready", "ready", PAST_DEADLINE);

    const first = await expireOverdueNotificationIntents(prisma, {
      now: NOW,
      limit: 50,
    });
    const afterFirst = await getIntent(prisma, { intentKey: ready });
    const second = await expireOverdueNotificationIntents(prisma, {
      now: NOW,
      limit: 50,
    });

    expect(first.expired).toBe(1);
    expect(second).toEqual({
      selected: 0,
      expired: 0,
      alreadyExpired: 0,
      conflicts: {},
      batchFilled: false,
    });
    expect(await getIntent(prisma, { intentKey: ready })).toEqual(afterFirst);
  });

  test("bounds one run and takes the most overdue first", async () => {
    const older = await seed("batch-older", "ready", EARLIER_PAST_DEADLINE);
    const newer = await seed("batch-newer", "ready", PAST_DEADLINE);

    const first = await expireOverdueNotificationIntents(prisma, {
      now: NOW,
      limit: 1,
    });

    expect(first).toMatchObject({ selected: 1, expired: 1, batchFilled: true });
    expect(await stateOf(older)).toBe("expired");
    expect(await stateOf(newer)).toBe("ready");

    const second = await expireOverdueNotificationIntents(prisma, {
      now: NOW,
      limit: 1,
    });
    expect(second).toMatchObject({ selected: 1, expired: 1 });
    expect(await stateOf(newer)).toBe("expired");
  });

  test("a beginSend that commits between the read and the write wins", async () => {
    const key = await seed("raced-ready", "ready", PAST_DEADLINE);
    // Interpose on the guarded write only: the sweep has already read the row
    // as `ready`, and a sender whose start preceded the deadline commits its
    // attempt first. The guard must miss and the re-read must answer
    // `send-in-flight` instead of overwriting the attempt.
    const racing = raceFirstIntentUpdate(prisma, async () => {
      const begun = await transitionIntent(prisma, {
        intentKey: key,
        transition: (stored) =>
          beginSend(stored, {
            attemptNonce: NONCE,
            startedAt: STARTED_BEFORE_DEADLINE,
          }),
      });
      expect(begun.outcome).toBe("applied");
    });

    const counts = await expireOverdueNotificationIntents(racing.db, {
      now: NOW,
      limit: 50,
    });

    expect(racing.raced()).toBe(true);
    expect(counts).toEqual({
      selected: 1,
      expired: 0,
      alreadyExpired: 0,
      conflicts: { "send-in-flight": 1 },
      batchFilled: false,
    });
    const stored = await getIntent(prisma, { intentKey: key });
    expect(stored?.intent.state).toEqual({
      kind: "sending",
      attemptNonce: NONCE,
      startedAt: STARTED_BEFORE_DEADLINE,
    });
    expect(stored?.intent.attemptCount).toBe(1);
  });
});
