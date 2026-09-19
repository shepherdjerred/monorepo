import { describe, expect, test } from "vitest";
import {
  EXPLORE_SUGGESTIONS,
  type ExploreFeatureContext,
} from "@scout-for-lol/data";
import { pickDiverseSuggestions } from "./explore-suggestions.ts";

// The catalog and the eligibility rule are owned by `@scout-for-lol/data` and
// tested beside them; what is left here is the sampling this module still owns.

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
      mvpVotesEnabled: true,
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
