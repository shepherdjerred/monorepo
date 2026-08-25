import { describe, expect, test } from "vitest";
import { hardDisabledFeatureForTemporalWork } from "./activities.ts";

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
