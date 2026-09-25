import { describe, expect, test } from "vitest";
import { providerQuotaApplicationFailure } from "./activities.ts";
import { hardDisabledFeatureForTemporalWork } from "./work-features.ts";

describe("Scout Temporal production policy", () => {
  test.each([
    ["custom-nights-expiry", "custom_nights_enabled"],
    ["progression-outbox", null],
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
  test("turns OpenRouter weekly quota failures into non-retryable activity failures", () => {
    const failure = providerQuotaApplicationFailure({
      status: 403,
      message: "Weekly key limit exceeded",
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
