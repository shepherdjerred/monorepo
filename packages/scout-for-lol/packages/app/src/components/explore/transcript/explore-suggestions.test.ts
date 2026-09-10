import { describe, expect, test } from "vitest";
import {
  EXPLORE_SUGGESTIONS,
  filterSuggestions,
  isSuggestionEligible,
  pickDiverseSuggestions,
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
    const dares = dummySuggestion("dares");
    const competitions = dummySuggestion("competitions");
    const hallOfFame = dummySuggestion("hall_of_fame");
    const customs = dummySuggestion("customs");
    const challenges = dummySuggestion("challenges");
    const reports = dummySuggestion("reports");

    // All disabled
    const emptyCtx: ExploreFeatureContext = {};
    expect(isSuggestionEligible(bucks, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(dares, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(competitions, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(hallOfFame, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(customs, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(challenges, emptyCtx)).toBe(false);
    expect(isSuggestionEligible(reports, emptyCtx)).toBe(false);

    // Each enabled individually
    expect(isSuggestionEligible(bucks, { bucksEnabled: true })).toBe(true);
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

describe("pickDiverseSuggestions", () => {
  test("picks the requested number of unique suggestions", () => {
    const picked = pickDiverseSuggestions(
      EXPLORE_SUGGESTIONS,
      {},
      { count: 4 },
    );
    expect(picked).toHaveLength(4);
    const unique = new Set(picked);
    expect(unique.size).toBe(4);
  });

  test("returns empty array for zero or negative count", () => {
    expect(
      pickDiverseSuggestions(EXPLORE_SUGGESTIONS, {}, { count: 0 }),
    ).toEqual([]);
    expect(
      pickDiverseSuggestions(EXPLORE_SUGGESTIONS, {}, { count: -1 }),
    ).toEqual([]);
  });

  test("excludes previously shown prompts when possible", () => {
    const firstSet = pickDiverseSuggestions(
      EXPLORE_SUGGESTIONS,
      {},
      { count: 4 },
    );
    const secondSet = pickDiverseSuggestions(
      EXPLORE_SUGGESTIONS,
      {},
      {
        count: 4,
        exclude: firstSet,
      },
    );
    expect(secondSet).toHaveLength(4);
    for (const item of secondSet) {
      expect(firstSet.includes(item)).toBe(false);
    }
  });

  test("ensures category diversity across picked items", () => {
    // When flags are enabled and we pick 4 items, they should be drawn from different categories
    const ctx: ExploreFeatureContext = {
      bucksEnabled: true,
      daresEnabled: true,
      competitionsEnabled: true,
      hallOfFameEnabled: true,
      customsEnabled: true,
      challengesEnabled: true,
      reportsEnabled: true,
    };
    const picked = pickDiverseSuggestions(EXPLORE_SUGGESTIONS, ctx, {
      count: 4,
    });
    const categoryMap = new Map<string, string>();
    for (const s of EXPLORE_SUGGESTIONS) {
      categoryMap.set(s.prompt, s.category);
    }
    const pickedCategories = picked.map((p) => categoryMap.get(p));
    const uniqueCategories = new Set(pickedCategories);
    expect(uniqueCategories.size).toBe(4);
  });
});
