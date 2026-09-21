import { describe, expect, test } from "vitest";
import {
  EXPLORE_SUGGESTIONS,
  filterSuggestions,
  isSuggestionEligible,
  type ExploreFeatureContext,
  type ExploreSuggestion,
} from "./explore-suggestions.ts";

function dummySuggestion(
  condition: ExploreSuggestion["condition"],
): ExploreSuggestion {
  return {
    prompt: `Question for ${condition}`,
    category: "trivia",
    condition,
  };
}

describe("EXPLORE_SUGGESTIONS catalog", () => {
  test("contains between 150 and 300 curated questions", () => {
    expect(EXPLORE_SUGGESTIONS.length).toBeGreaterThanOrEqual(150);
    expect(EXPLORE_SUGGESTIONS.length).toBeLessThanOrEqual(300);
  });

  test("all prompts are non-empty and unique", () => {
    const seen = new Set<string>();
    for (const item of EXPLORE_SUGGESTIONS) {
      expect(item.prompt.trim().length).toBeGreaterThan(5);
      expect(seen.has(item.prompt)).toBe(false);
      seen.add(item.prompt);
    }
  });

  test("includes suggested questions for each specific feature", () => {
    const conditions = new Set(EXPLORE_SUGGESTIONS.map((s) => s.condition));
    expect(conditions.has("bucks")).toBe(true);
    expect(conditions.has("mvp_votes")).toBe(true);
    expect(conditions.has("dares")).toBe(true);
    expect(conditions.has("competitions")).toBe(true);
    expect(conditions.has("hall_of_fame")).toBe(true);
    expect(conditions.has("customs")).toBe(true);
    expect(conditions.has("challenges")).toBe(true);
    expect(conditions.has("reports")).toBe(true);
    expect(conditions.has("always")).toBe(true);
  });
});

describe("isSuggestionEligible and filterSuggestions", () => {
  test("always condition is always eligible", () => {
    expect(isSuggestionEligible(dummySuggestion("always"), {})).toBe(true);
  });

  test("evaluates feature flags accurately", () => {
    const bucks = dummySuggestion("bucks");
    const mvpVotes = dummySuggestion("mvp_votes");
    const dares = dummySuggestion("dares");
    const competitions = dummySuggestion("competitions");
    const hallOfFame = dummySuggestion("hall_of_fame");
    const customs = dummySuggestion("customs");
    const challenges = dummySuggestion("challenges");
    const reports = dummySuggestion("reports");

    // All disabled
    const emptyCtx: ExploreFeatureContext = {};
    expect(isSuggestionEligible(bucks, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(mvpVotes, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(dares, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(competitions, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(hallOfFame, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(customs, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(challenges, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(reports, emptyCtx)).toBe(false);

    // Each enabled individually
    expect(isSuggestionEligible(bucks, { bucksEnabled: true })).toBe(true);
    expect(isSuggestionEligible(mvpVotes, { mvpVotesEnabled: true })).toBe(
      true,
    );
    expect(isSuggestionEligible(dares, { daresEnabled: true })).toBe(true);
    expect(
      isSuggestionEligible(competitions, { competitionsEnabled: true }),
    ).toBe(true);
    expect(isSuggestionEligible(hallOfFame, { hallOfFameEnabled: true })).toBe(
      true,
    );
    expect(isSuggestionEligible(customs, { customsEnabled: true })).toBe(true);
    expect(isSuggestionEligible(challenges, { challengesEnabled: true })).toBe(
      true,
    );
    expect(isSuggestionEligible(reports, { reportsEnabled: true })).toBe(true);
  });

  test("filterSuggestions filters out disabled features while keeping general prompts", () => {
    const filteredNoFlags = filterSuggestions(EXPLORE_SUGGESTIONS, {});
    expect(
      filteredNoFlags.some(
        (s) => s.condition === "bucks" || s.condition === "dares",
      ),
    ).toBe(false);
    expect(filteredNoFlags.some((s) => s.condition === "competitions")).toBe(
      false,
    );
    expect(filteredNoFlags.some((s) => s.condition === "hall_of_fame")).toBe(
      false,
    );
    expect(filteredNoFlags.every((s) => s.condition === "always")).toBe(true);

    const filteredWithBucks = filterSuggestions(EXPLORE_SUGGESTIONS, {
      bucksEnabled: true,
      daresEnabled: true,
    });
    expect(
      filteredWithBucks.some((s) => s.prompt.includes("Bryan Bucks")),
    ).toBe(true);
    expect(filteredWithBucks.some((s) => s.condition === "competitions")).toBe(
      false,
    );
  });
});
