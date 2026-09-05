import { describe, expect, test } from "vitest";
import { classifyDareIntentConfirmation } from "#src/lib/dares/dare-intent-confirmation.ts";

describe("Dare intent confirmation presentation", () => {
  test("marks only the action's successful domain result as confirmed", () => {
    expect(classifyDareIntentConfirmation("fund", { kind: "funded" })).toEqual({
      status: "confirmed",
      message: "funded",
      retryable: false,
      deliveryWarning: null,
    });
    expect(
      classifyDareIntentConfirmation("fund", {
        kind: "insufficient",
        balance: 3,
        needed: 20,
      }),
    ).toEqual({
      status: "failed",
      message: "insufficient",
      retryable: true,
      deliveryWarning: null,
    });
  });

  test("recognizes an idempotent replay only when its stored result succeeded", () => {
    expect(
      classifyDareIntentConfirmation("accept", {
        kind: "already_consumed",
        result: { kind: "accepted", activated: true },
      }),
    ).toEqual({
      status: "confirmed",
      message: "accepted earlier",
      retryable: false,
      deliveryWarning: null,
    });
    expect(
      classifyDareIntentConfirmation("accept", {
        kind: "already_consumed",
        result: { kind: "wrong_state" },
      }).status,
    ).toBe("failed");
  });

  test("keeps feature and balance failures available for retry", () => {
    expect(
      classifyDareIntentConfirmation("contribute", {
        kind: "feature_disabled",
      }).retryable,
    ).toBe(true);
    expect(
      classifyDareIntentConfirmation("accept", { kind: "intent_expired" })
        .retryable,
    ).toBe(false);
  });

  test("separately warns when a committed action loses public delivery", () => {
    expect(
      classifyDareIntentConfirmation("fund", {
        kind: "funded",
        callout: "failed",
      }),
    ).toEqual({
      status: "confirmed",
      message: "funded",
      retryable: false,
      deliveryWarning:
        "The action committed, but Scout could not post or refresh the public Dare callout. Nothing was reversed; delivery will be retried.",
    });
  });
});
