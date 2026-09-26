import { describe, expect, test } from "vitest";
import { providerQuotaApplicationFailure } from "./activities.ts";
import { hardDisabledFeatureForTemporalWork } from "./work-features.ts";

describe("Scout Temporal production policy", () => {
  test.each([
    ["custom-nights-expiry", "custom_nights_enabled"],
    ["progression-outbox", null],
    ["notification-intent-expiry", null],
    ["bucks-reconciliation", "betting_enabled"],
    ["weekly-bucks-leaderboard", "betting_enabled"],
    ["competition-refresh", null],
    ["clash-snapshot", null],
    ["prematch", null],
  ])("maps %s to its hard-disable feature", (kind, expected) => {
    expect(hardDisabledFeatureForTemporalWork(kind)).toBe(expected);
  });
});

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
