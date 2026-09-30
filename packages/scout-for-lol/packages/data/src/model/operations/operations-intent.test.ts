import { describe, expect, test } from "vitest";
import {
  ConfirmationIntentKindSchema,
  ConfirmationIntentPayloadSchema,
} from "#src/model/bucks/confirmation-intent.ts";
import {
  OperationsIntentKindSchema,
  OperationsIntentPayloadSchema,
} from "#src/model/operations/operations-intent.ts";

/**
 * The operations arms are parsed out of a stored JSON column at confirm time,
 * so the interesting property is not that a good payload parses — it is that a
 * payload which has drifted, been hand-edited, or been posted by a client that
 * guessed at the shape does NOT. Every arm names a pipeline action with a real
 * effect, so anything the schema lets through is something an operator can be
 * made to confirm.
 */

const INTENT_KEY = "notification:NA1_5312279829:channel:410003";
const MATCH_ID = "NA1_5312279829";
const NONCE = "run-77:attempt-2";
const MESSAGE_ID = "123456789012345678";
const DELIVERED_AT = "2026-09-13T18:04:05.000Z";

const arms = [
  { kind: "ops_reconcile_pipeline", version: 1 },
  { kind: "ops_retry_notification", version: 1, intentKey: INTENT_KEY },
  {
    kind: "ops_suppress_stale_notification",
    version: 1,
    intentKey: INTENT_KEY,
    note: "Match is two days stale after the gateway outage.",
  },
  {
    kind: "ops_resolve_unknown_delivery",
    version: 1,
    intentKey: INTENT_KEY,
    answer: {
      outcome: "delivered",
      attemptNonce: NONCE,
      messageId: MESSAGE_ID,
      deliveredAt: DELIVERED_AT,
    },
  },
  {
    kind: "ops_resolve_unknown_delivery",
    version: 1,
    intentKey: INTENT_KEY,
    answer: { outcome: "not-delivered", attemptNonce: NONCE },
  },
  { kind: "ops_repair_projection", version: 1, riotMatchId: MATCH_ID },
  {
    kind: "ops_release_recovery_policy",
    version: 1,
    recoveryBatchId: "recovery-2026-09-13-a",
    to: "stale-private-only",
  },
] as const;

describe("operations intent payloads", () => {
  test.each(arms)("round-trips $kind through JSON storage", (arm) => {
    const parsed = OperationsIntentPayloadSchema.parse(arm);
    // The payload column is a JSON string, so the round trip that matters is
    // the one through serialization, not a structural clone.
    const column = JSON.stringify(parsed);
    const readBack: unknown = JSON.parse(column);
    expect(OperationsIntentPayloadSchema.parse(readBack)).toEqual(parsed);
  });

  test.each(arms)("$kind parses through the shared union too", (arm) => {
    // Confirm reads the stored column through ConfirmationIntentPayloadSchema,
    // never through the operations union directly. An arm that only parsed in
    // isolation would be unreadable at the moment it mattered.
    expect(ConfirmationIntentPayloadSchema.parse(arm)).toEqual(
      OperationsIntentPayloadSchema.parse(arm),
    );
  });

  test("every operations kind is a confirmation-intent kind", () => {
    for (const kind of OperationsIntentKindSchema.options) {
      expect(ConfirmationIntentKindSchema.parse(kind)).toBe(kind);
    }
  });

  test("the kind enum and the payload arms cannot drift apart", () => {
    const armKinds = OperationsIntentPayloadSchema.options.map(
      (option) => option.shape.kind.value,
    );
    expect([...armKinds].sort()).toEqual(
      [...OperationsIntentKindSchema.options].sort(),
    );
  });
});

describe("operations intent payloads reject junk", () => {
  test("an unknown kind is not an operations intent", () => {
    expect(
      OperationsIntentPayloadSchema.safeParse({
        kind: "ops_delete_everything",
        version: 1,
      }).success,
    ).toBe(false);
  });

  test("a dare or creation payload is not an operations intent", () => {
    expect(
      OperationsIntentPayloadSchema.safeParse({ kind: "dare_fund" }).success,
    ).toBe(false);
  });

  test("unknown fields are rejected rather than ignored", () => {
    expect(
      OperationsIntentPayloadSchema.safeParse({
        kind: "ops_repair_projection",
        version: 1,
        riotMatchId: MATCH_ID,
        alsoDeleteTheLake: true,
      }).success,
    ).toBe(false);
  });

  test("a match id must be a Riot match id, not any string", () => {
    expect(
      OperationsIntentPayloadSchema.safeParse({
        kind: "ops_repair_projection",
        version: 1,
        riotMatchId: "5312279829",
      }).success,
    ).toBe(false);
  });

  test("a delivered answer without a message id is refused", () => {
    // The domain permits an absent message id; this surface does not. An
    // operator who cannot name the message has not finished investigating, and
    // `delivered` is permanent.
    expect(
      OperationsIntentPayloadSchema.safeParse({
        kind: "ops_resolve_unknown_delivery",
        version: 1,
        intentKey: INTENT_KEY,
        answer: {
          outcome: "delivered",
          attemptNonce: NONCE,
          deliveredAt: DELIVERED_AT,
        },
      }).success,
    ).toBe(false);
  });

  test("an answer without an attempt nonce is refused", () => {
    // The nonce is what binds the answer to the attempt the operator looked at.
    expect(
      OperationsIntentPayloadSchema.safeParse({
        kind: "ops_resolve_unknown_delivery",
        version: 1,
        intentKey: INTENT_KEY,
        answer: { outcome: "not-delivered" },
      }).success,
    ).toBe(false);
  });

  test("a delivery instant without an offset is refused", () => {
    expect(
      OperationsIntentPayloadSchema.safeParse({
        kind: "ops_resolve_unknown_delivery",
        version: 1,
        intentKey: INTENT_KEY,
        answer: {
          outcome: "delivered",
          attemptNonce: NONCE,
          messageId: MESSAGE_ID,
          deliveredAt: "2026-09-13T18:04:05",
        },
      }).success,
    ).toBe(false);
  });

  test("a recovery policy release cannot name any other target policy", () => {
    // `normal` is the release the domain refuses outright, so the schema makes
    // asking for it unrepresentable rather than merely rejected downstream.
    for (const to of ["normal", "no-external"]) {
      expect(
        OperationsIntentPayloadSchema.safeParse({
          kind: "ops_release_recovery_policy",
          version: 1,
          recoveryBatchId: "recovery-2026-09-13-a",
          to,
        }).success,
      ).toBe(false);
    }
  });

  test("a suppression note must carry something an auditor can read", () => {
    for (const note of ["", "   ", "x".repeat(281)]) {
      expect(
        OperationsIntentPayloadSchema.safeParse({
          kind: "ops_suppress_stale_notification",
          version: 1,
          intentKey: INTENT_KEY,
          note,
        }).success,
      ).toBe(false);
    }
  });

  test("a payload from a future version is refused, not coerced", () => {
    expect(
      OperationsIntentPayloadSchema.safeParse({
        kind: "ops_reconcile_pipeline",
        version: 2,
      }).success,
    ).toBe(false);
  });
});
