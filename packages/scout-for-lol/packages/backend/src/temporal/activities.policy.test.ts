import { describe, expect, test } from "vitest";
import {
  hardDisabledFeatureForTemporalWork,
  providerQuotaApplicationFailure,
} from "./activities.ts";

describe("Scout Temporal production policy", () => {
  test.each([
    ["tournament-lobbies", "tournament_lobbies_enabled"],
    ["bucks-reconciliation", "betting_enabled"],
    ["weekly-bucks-leaderboard", "betting_enabled"],
    ["competition-refresh", null],
    ["prematch", null],
  ])("maps %s to its hard-disable feature", (kind, expected) => {
    expect(hardDisabledFeatureForTemporalWork(kind)).toBe(expected);
  });
});

describe("Scout detached-work provider failures", () => {
  test("turns OpenRouter weekly quota failures into non-retryable activity failures", () => {
    const failure = providerQuotaApplicationFailure(
      { stage: "beta", kind: "parlay-generation", workId: "parlay:NA1_1" },
      { status: 403, message: "Weekly key limit exceeded" },
    );
    expect(failure).toMatchObject({
      type: "ProviderQuotaExhausted",
      nonRetryable: true,
    });
  });

  test("leaves transient provider failures retryable", () => {
    expect(
      providerQuotaApplicationFailure(
        { stage: "beta", kind: "parlay-generation", workId: "parlay:NA1_1" },
        new Error("connection reset"),
      ),
    ).toBeNull();
  });
});
