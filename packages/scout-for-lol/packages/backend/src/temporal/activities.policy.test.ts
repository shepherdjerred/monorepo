import { describe, expect, test } from "vitest";
import { providerQuotaApplicationFailure } from "./activities.ts";
import { temporalWorkRetired } from "./work-features.ts";

describe("Scout Temporal production policy", () => {
  test.each([
    ["progression-reconciliation", false],
    ["notification-intent-expiry", false],
    ["competition-refresh", false],
    ["clash-snapshot", false],
    ["prematch", false],
  ])("keeps current %s work active", (kind, expected) => {
    expect(temporalWorkRetired(kind)).toBe(expected);
  });
});

test.each(["bucks-reconciliation", "weekly-bucks-leaderboard"])(
  "retired %s completes without effects in every stage",
  (kind) => {
    expect(temporalWorkRetired(kind)).toBe(true);
  },
);

describe("Scout detached-work provider failures", () => {
  test("turns provider spend-cap failures into non-retryable activity failures", () => {
    const failure = providerQuotaApplicationFailure({
      status: 429,
      message:
        "You exceeded your current quota, please check your plan and billing details.",
    });
    expect(failure).toMatchObject({
      type: "ProviderQuotaExhausted",
      nonRetryable: true,
    });
  });

  test("leaves transient provider failures retryable", () => {
    expect(
      providerQuotaApplicationFailure(new Error("connection reset")),
    ).toBeNull();
  });
});
