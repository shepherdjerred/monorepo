import { describe, expect, test } from "vitest";
import { classifyDareIntentConfirmation } from "#src/lib/dare-intent-confirmation.ts";

describe("Dare intent confirmation presentation", () => {
  test("marks only the action's successful domain result as confirmed", () => {
    expect(classifyDareIntentConfirmation("fund", { kind: "funded" })).toEqual({
      status: "confirmed",
      message: "funded",
      retryable: false,
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
});
