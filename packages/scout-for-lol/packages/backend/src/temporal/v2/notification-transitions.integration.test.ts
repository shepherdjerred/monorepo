import { afterAll, describe, expect, test } from "vitest";
import {
  DiscordMessageIdSchema,
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
  type NotificationIntentKey,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationAttemptNonceSchema,
  NotificationIntentSchema,
  type NotificationAttemptNonce,
} from "@scout-for-lol/domain/notifications/intent.ts";
import { ScoutStageSchema } from "@scout-for-lol/temporal/contracts";
import type {
  ScoutIntentAttemptRefV2,
  ScoutIntentRefV2,
} from "@scout-for-lol/temporal/contracts-v2";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId } from "#src/testing/test-ids.ts";
import {
  getIntent,
  upsertIntent,
} from "#src/database/durable/intent-repository.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";

/**
 * The V2 notification lane's three durable steps, against real rows.
 *
 * These Activities read the module-level Prisma singleton rather than taking a
 * client, so the singleton is pointed at this file's own database instead of
 * being replaced: `#src/database/index.ts` reads `DATABASE_URL` once, when it
 * is first imported, and the pg pool connects lazily — so setting the variable
 * before the first import of anything that reaches it gives the production
 * client an isolated, migrated database. Nothing about the code under test is
 * stubbed, which is the point: a dependency-injection seam added for a test
 * would not be the code that runs in production.
 */
const testDatabase = createTestDatabase("temporal-v2-notification-transitions");
Bun.env["DATABASE_URL"] = testDatabase.dbUrl;
const { prisma } = testDatabase;

const { prisma: activityPrisma } = await import("#src/database/index.ts");
const {
  beginNotificationSendV2,
  markNotificationReadyV2,
  recordNotificationOutcomeV2,
} = await import("#src/temporal/v2/notification-transitions.ts");

afterAll(async () => {
  await prisma.$disconnect();
  await activityPrisma.$disconnect();
});

const STAGE = ScoutStageSchema.parse("dev");
const MATCH_ID = RiotMatchIdSchema.parse("NA1_8200");
const CREATED_AT = "2026-09-12T10:00:00.000Z";

/**
 * `beginNotificationSendV2` stamps `startedAt` from the real clock and
 * `beginSend` refuses an attempt started past the deadline, so every intent
 * here is deliberately fresh far beyond the life of the suite. A deadline near
 * the present would make these tests fail on the calendar rather than on the
 * behaviour they describe.
 */
const FRESHNESS_DEADLINE = "2099-01-01T00:00:00.000Z";

const NONCE_A = NotificationAttemptNonceSchema.parse("attempt-a");
const NONCE_B = NotificationAttemptNonceSchema.parse("attempt-b");
const MESSAGE_ID = DiscordMessageIdSchema.parse("300000000000000001");

const RETRYABLE_FAILURE = {
  classification: "retryable",
  reason: "rate-limited",
} as const;
const TERMINAL_FAILURE = {
  classification: "terminal",
  reason: "permission-denied",
} as const;

function intentRef(intentKey: NotificationIntentKey): ScoutIntentRefV2 {
  return { stage: STAGE, intentKey };
}

function attemptRef(
  intentKey: NotificationIntentKey,
  attemptNonce: NotificationAttemptNonce,
): ScoutIntentAttemptRefV2 {
  return { stage: STAGE, intentKey, attemptNonce };
}

function intentRecord(
  intentKey: NotificationIntentKey,
): MatchNotificationIntentRecord {
  return {
    matchId: MATCH_ID,
    intent: NotificationIntentSchema.parse({
      key: intentKey,
      target: { kind: "channel", channelId: testChannelId("8200") },
      freshnessDeadline: FRESHNESS_DEADLINE,
      createdAt: CREATED_AT,
      attemptCount: 0,
      state: { kind: "pending" },
    }),
  };
}

/** One fresh `pending` intent, minted the way a match pass mints one. */
async function seedIntent(name: string): Promise<NotificationIntentKey> {
  const intentKey = NotificationIntentKeySchema.parse(
    `postmatch-discord:${MATCH_ID}:${name}`,
  );
  expect(await upsertIntent(prisma, intentRecord(intentKey))).toEqual({
    outcome: "applied",
  });
  return intentKey;
}

/** An intent with one attempt in flight, driven there by the Activities. */
async function sendingIntent(
  name: string,
  attemptNonce: NotificationAttemptNonce,
): Promise<NotificationIntentKey> {
  const intentKey = await seedIntent(name);
  await markNotificationReadyV2(intentRef(intentKey));
  const began = await beginNotificationSendV2(
    attemptRef(intentKey, attemptNonce),
  );
  expect(began.commit).toEqual({ outcome: "applied" });
  return intentKey;
}

/** An intent parked in the domain's operator-only dead end. */
async function unknownDeliveryIntent(
  name: string,
): Promise<NotificationIntentKey> {
  const intentKey = await sendingIntent(name, NONCE_A);
  const parked = await recordNotificationOutcomeV2({
    ...attemptRef(intentKey, NONCE_A),
    delivery: { outcome: "unknown" },
  });
  expect(parked.commit).toEqual({ outcome: "applied" });
  return intentKey;
}

describe("markNotificationReadyV2", () => {
  test("moves pending to ready and answers a replay from the stored row", async () => {
    const intentKey = await seedIntent("ready-applied");

    expect(await markNotificationReadyV2(intentRef(intentKey))).toEqual({
      commit: { outcome: "applied" },
      state: { kind: "ready" },
      attemptCount: 0,
    });
    expect(await markNotificationReadyV2(intentRef(intentKey))).toEqual({
      commit: { outcome: "already-applied" },
      state: { kind: "ready" },
      attemptCount: 0,
    });

    const stored = await getIntent(prisma, { intentKey });
    expect(stored?.intent.state).toEqual({ kind: "ready" });
    expect(stored?.intent.attemptCount).toBe(0);
  });

  test("a refusal reports the state the row is in, not the one it asked for", async () => {
    // The whole reason `notificationTransitionV2` re-reads on a non-applied
    // answer. A run that reported the state it WANTED would tell its Workflow
    // to keep driving an intent another run has already moved on — here, into
    // a send that is in flight right now.
    const intentKey = await sendingIntent("ready-refused", NONCE_A);

    const refused = await markNotificationReadyV2(intentRef(intentKey));
    expect(refused.commit).toEqual({
      outcome: "conflict",
      reason: "invalid-source-state",
    });
    expect(refused.state).toMatchObject({
      kind: "sending",
      attemptNonce: NONCE_A,
    });
    expect(refused.attemptCount).toBe(1);

    const stored = await getIntent(prisma, { intentKey });
    expect(refused.state).toEqual(stored?.intent.state);
  });
});

describe("beginNotificationSendV2", () => {
  test("commits the attempt nonce and counts the attempt before anything is sent", async () => {
    const intentKey = await seedIntent("send-applied");
    await markNotificationReadyV2(intentRef(intentKey));

    const began = await beginNotificationSendV2(attemptRef(intentKey, NONCE_A));
    expect(began.commit).toEqual({ outcome: "applied" });
    expect(began.attemptCount).toBe(1);
    expect(began.state).toMatchObject({
      kind: "sending",
      attemptNonce: NONCE_A,
    });

    // The nonce has to be on the ROW before the Discord call, because a worker
    // that dies mid-send is identified by exactly this column.
    const stored = await getIntent(prisma, { intentKey });
    expect(stored?.intent.state).toEqual(began.state);
    expect(stored?.intent.attemptCount).toBe(1);
  });

  test("a second nonce cannot start a send while one is in flight", async () => {
    const intentKey = await sendingIntent("send-contended", NONCE_A);

    const refused = await beginNotificationSendV2(
      attemptRef(intentKey, NONCE_B),
    );
    expect(refused.commit).toEqual({
      outcome: "conflict",
      reason: "already-sending",
    });

    // The refused attempt must leave the in-flight one addressable: if the
    // stored nonce moved, the outcome the first attempt eventually reports
    // could no longer be matched to it.
    const stored = await getIntent(prisma, { intentKey });
    expect(stored?.intent.state).toMatchObject({
      kind: "sending",
      attemptNonce: NONCE_A,
    });
    expect(stored?.intent.attemptCount).toBe(1);
  });
});

describe("recordNotificationOutcomeV2", () => {
  test("a delivered outcome reaches delivered carrying the message id", async () => {
    const intentKey = await sendingIntent("outcome-delivered", NONCE_A);

    const delivered = await recordNotificationOutcomeV2({
      ...attemptRef(intentKey, NONCE_A),
      delivery: { outcome: "delivered", messageId: MESSAGE_ID },
    });
    expect(delivered.commit).toEqual({ outcome: "applied" });
    expect(delivered.state).toMatchObject({
      kind: "delivered",
      messageId: MESSAGE_ID,
    });

    // The message id is what lets an operator check the claim against Discord,
    // so it has to be on the row rather than only in the Activity's answer.
    const stored = await getIntent(prisma, { intentKey });
    expect(stored?.intent.state).toEqual(delivered.state);
  });

  test("a retryable failure returns the intent to ready and keeps the reason", async () => {
    const intentKey = await sendingIntent("outcome-retryable", NONCE_A);

    expect(
      await recordNotificationOutcomeV2({
        ...attemptRef(intentKey, NONCE_A),
        delivery: { outcome: "failed", failure: RETRYABLE_FAILURE },
      }),
    ).toEqual({
      commit: { outcome: "applied" },
      state: { kind: "ready" },
      attemptCount: 1,
    });

    // Back to ready, but the attempt still counted: a retry that reset the
    // count would let a failing target be retried forever.
    const stored = await getIntent(prisma, { intentKey });
    expect(stored?.intent.state).toEqual({ kind: "ready" });
    expect(stored?.intent.attemptCount).toBe(1);
    expect(stored?.intent.lastFailure).toEqual(RETRYABLE_FAILURE);
  });

  test("a terminal permission failure reaches permission-denied", async () => {
    const intentKey = await sendingIntent("outcome-terminal", NONCE_A);

    expect(
      await recordNotificationOutcomeV2({
        ...attemptRef(intentKey, NONCE_A),
        delivery: { outcome: "failed", failure: TERMINAL_FAILURE },
      }),
    ).toEqual({
      commit: { outcome: "applied" },
      state: { kind: "permission-denied" },
      attemptCount: 1,
    });

    const stored = await getIntent(prisma, { intentKey });
    expect(stored?.intent.state).toEqual({ kind: "permission-denied" });
    expect(stored?.intent.lastFailure).toEqual(TERMINAL_FAILURE);
  });

  test("an unobserved outcome parks the intent against the attempt that produced it", async () => {
    const intentKey = await sendingIntent("outcome-unknown", NONCE_A);

    const parked = await recordNotificationOutcomeV2({
      ...attemptRef(intentKey, NONCE_A),
      delivery: { outcome: "unknown" },
    });
    expect(parked.commit).toEqual({ outcome: "applied" });
    expect(parked.state).toMatchObject({
      kind: "unknown-delivery",
      attemptNonce: NONCE_A,
    });

    // The nonce is what an operator resolves against, so an `unknown-delivery`
    // that lost it would be unresolvable: nothing could say which attempt was
    // investigated.
    const stored = await getIntent(prisma, { intentKey });
    expect(stored?.intent.state).toEqual(parked.state);
  });

  test("an outcome carrying the wrong nonce cannot close the attempt in flight", async () => {
    const intentKey = await sendingIntent("outcome-mismatch", NONCE_A);

    const mismatched = await recordNotificationOutcomeV2({
      ...attemptRef(intentKey, NONCE_B),
      delivery: { outcome: "delivered", messageId: MESSAGE_ID },
    });
    expect(mismatched.commit).toEqual({
      outcome: "conflict",
      reason: "attempt-nonce-mismatch",
    });

    // A crashed worker's stale completion must not mark a LATER attempt
    // delivered, so the row stays exactly where the live attempt left it.
    const stored = await getIntent(prisma, { intentKey });
    expect(stored?.intent.state).toMatchObject({
      kind: "sending",
      attemptNonce: NONCE_A,
    });
    expect(mismatched.state).toEqual(stored?.intent.state);
  });
});

describe("the unknown-delivery dead end", () => {
  test("no automatic path can move a parked intent, whichever Activity asks", async () => {
    // This is the guarantee that stops a user being told the same thing twice.
    // The request left, the response did not arrive, and the only thing that
    // may move the row is an operator who went and looked — so every one of
    // the lane's three Activities has to refuse, including the outcome
    // recorder carrying the very nonce that produced the ambiguity.
    const intentKey = await unknownDeliveryIntent("parked");
    const parked = await getIntent(prisma, { intentKey });
    expect(parked?.intent.state).toMatchObject({
      kind: "unknown-delivery",
      attemptNonce: NONCE_A,
    });

    const refusals = [
      await markNotificationReadyV2(intentRef(intentKey)),
      await beginNotificationSendV2(attemptRef(intentKey, NONCE_B)),
      await recordNotificationOutcomeV2({
        ...attemptRef(intentKey, NONCE_A),
        delivery: { outcome: "delivered", messageId: MESSAGE_ID },
      }),
      await recordNotificationOutcomeV2({
        ...attemptRef(intentKey, NONCE_A),
        delivery: { outcome: "failed", failure: RETRYABLE_FAILURE },
      }),
      await recordNotificationOutcomeV2({
        ...attemptRef(intentKey, NONCE_A),
        delivery: { outcome: "unknown" },
      }),
    ];

    for (const refused of refusals) {
      expect(refused.commit).toEqual({
        outcome: "conflict",
        reason: "unknown-delivery-requires-operator",
      });
      expect(refused.state).toEqual(parked?.intent.state);
    }

    // Not one of the five attempts changed a column — nonce, attempt count or
    // state.
    expect(await getIntent(prisma, { intentKey })).toEqual(parked);
  });
});
