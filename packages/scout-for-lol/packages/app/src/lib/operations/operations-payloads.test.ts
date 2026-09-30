import { describe, expect, test } from "vitest";
import {
  buildOperationsPayload,
  operationsActionLabel,
  operationsCardHeading,
  operationsRequestSummary,
  operationsStartsWorkflow,
  parseOperationsMatchId,
} from "#src/lib/operations/operations-payloads.ts";

const INTENT_KEY = "match:NA1_1234567890/channel:1337623164146155593";
const MATCH_ID = "NA1_1234567890";
const MESSAGE_ID = "1337623164146155593";
const NONCE = "attempt-3";

describe("building payloads", () => {
  test("accepts each arm the operations router defines", () => {
    expect(
      buildOperationsPayload({ kind: "ops_reconcile_pipeline" }),
    ).toMatchObject({
      status: "valid",
      payload: { kind: "ops_reconcile_pipeline", version: 1 },
    });
    expect(
      buildOperationsPayload({
        kind: "ops_retry_notification",
        intentKey: INTENT_KEY,
      }).status,
    ).toBe("valid");
    expect(
      buildOperationsPayload({
        kind: "ops_suppress_stale_notification",
        intentKey: INTENT_KEY,
        note: "Deadline passed during the Riot outage.",
      }).status,
    ).toBe("valid");
    expect(
      buildOperationsPayload({
        kind: "ops_repair_projection",
        riotMatchId: MATCH_ID,
      }).status,
    ).toBe("valid");
    expect(
      buildOperationsPayload({
        kind: "ops_release_recovery_policy",
        recoveryBatchId: "batch-7",
      }),
    ).toMatchObject({
      status: "valid",
      // The only widening the machine permits, so the console cannot ask for
      // another one.
      payload: { to: "stale-private-only" },
    });
  });

  test("both delivery answers carry the attempt they investigated", () => {
    expect(
      buildOperationsPayload({
        kind: "ops_resolve_unknown_delivery",
        intentKey: INTENT_KEY,
        attemptNonce: NONCE,
        outcome: "not-delivered",
        messageId: "",
        deliveredAt: "",
      }),
    ).toMatchObject({
      status: "valid",
      payload: { answer: { outcome: "not-delivered", attemptNonce: NONCE } },
    });

    expect(
      buildOperationsPayload({
        kind: "ops_resolve_unknown_delivery",
        intentKey: INTENT_KEY,
        attemptNonce: NONCE,
        outcome: "delivered",
        messageId: MESSAGE_ID,
        deliveredAt: "2026-09-13T10:00:00.000Z",
      }).status,
    ).toBe("valid");
  });

  test("refuses operator input the server would refuse, naming the field", () => {
    const emptyNote = buildOperationsPayload({
      kind: "ops_suppress_stale_notification",
      intentKey: INTENT_KEY,
      note: "   ",
    });
    expect(emptyNote.status).toBe("invalid");
    expect(emptyNote).toMatchObject({
      message: expect.stringContaining("note"),
    });

    // A delivered answer with no message id is an unfinished investigation,
    // and the resulting state would be permanent.
    expect(
      buildOperationsPayload({
        kind: "ops_resolve_unknown_delivery",
        intentKey: INTENT_KEY,
        attemptNonce: NONCE,
        outcome: "delivered",
        messageId: "",
        deliveredAt: "2026-09-13T10:00:00.000Z",
      }).status,
    ).toBe("invalid");

    expect(
      buildOperationsPayload({
        kind: "ops_resolve_unknown_delivery",
        intentKey: INTENT_KEY,
        attemptNonce: NONCE,
        outcome: "delivered",
        messageId: MESSAGE_ID,
        deliveredAt: "yesterday",
      }).status,
    ).toBe("invalid");

    expect(
      buildOperationsPayload({
        kind: "ops_repair_projection",
        riotMatchId: "not-a-match",
      }).status,
    ).toBe("invalid");
  });
});

describe("match ids", () => {
  test("validates through the shared schema and trims what was typed", () => {
    expect(parseOperationsMatchId(`  ${MATCH_ID} `)).toBe(MATCH_ID);
    expect(parseOperationsMatchId("NA1_")).toBeNull();
    expect(parseOperationsMatchId("ZZ9_1")).toBeNull();
  });
});

describe("what the operator is told", () => {
  test("each summary describes that arm and promises nothing more", () => {
    expect(
      operationsRequestSummary({ kind: "ops_reconcile_pipeline" }),
    ).toContain("Nothing is running yet");
    expect(
      operationsRequestSummary({
        kind: "ops_retry_notification",
        intentKey: INTENT_KEY,
      }),
    ).toContain("cannot rescue an intent that is already sending");
    expect(
      operationsRequestSummary({
        kind: "ops_suppress_stale_notification",
        intentKey: INTENT_KEY,
        note: "",
      }),
    ).toContain("refused as not-stale");
    expect(
      operationsRequestSummary({
        kind: "ops_resolve_unknown_delivery",
        intentKey: INTENT_KEY,
        attemptNonce: NONCE,
        outcome: "delivered",
        messageId: "",
        deliveredAt: "",
      }),
    ).toContain("permanent");
    expect(
      operationsRequestSummary({
        kind: "ops_release_recovery_policy",
        recoveryBatchId: "batch-7",
      }),
    ).toContain("only widening the machine permits");
  });

  test("headings follow the card's state", () => {
    expect(operationsCardHeading("ops_repair_projection", "pending")).toBe(
      "Repair this projection",
    );
    expect(operationsCardHeading("ops_repair_projection", "failed")).toBe(
      "The projection was not repaired",
    );
    expect(operationsCardHeading("ops_repair_projection", "expired")).toBe(
      "This confirmation expired",
    );
    expect(operationsActionLabel("ops_release_recovery_policy")).toBe(
      "Widen policy",
    );
  });
});

test("only the three arms that describe a start need Temporal", () => {
  expect(operationsStartsWorkflow("ops_reconcile_pipeline")).toBe(true);
  expect(operationsStartsWorkflow("ops_retry_notification")).toBe(true);
  expect(operationsStartsWorkflow("ops_repair_projection")).toBe(true);
  expect(operationsStartsWorkflow("ops_suppress_stale_notification")).toBe(
    false,
  );
  expect(operationsStartsWorkflow("ops_resolve_unknown_delivery")).toBe(false);
  expect(operationsStartsWorkflow("ops_release_recovery_policy")).toBe(false);
});
