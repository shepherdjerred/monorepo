import {
  filterSuggestions,
  type ExploreFeatureContext,
  type ExploreSuggestion,
  type SuggestionCategory,
} from "@scout-for-lol/data";

/**
 * Picking which starter chips a screen shows.
 *
 * The catalog and the eligibility rule moved to `@scout-for-lol/data` so the
 * Explore replay eval can drive the same prompts through the real agent
 * without a second copy of the condition table. What stays here is the part
 * that is purely presentation: choosing a diverse handful to render.
 */

function shuffle<T>(array: readonly T[], random: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const current = result[i];
    const target = result[j];
    if (current !== undefined && target !== undefined) {
      result[i] = target;
      result[j] = current;
    }
  }
  return result;
}

function groupByCategory(
  items: readonly ExploreSuggestion[],
): Map<SuggestionCategory, ExploreSuggestion[]> {
  const byCategory = new Map<SuggestionCategory, ExploreSuggestion[]>();
  for (const item of items) {
    const list = byCategory.get(item.category);
    if (list === undefined) {
      byCategory.set(item.category, [item]);
    } else {
      list.push(item);
    }
  }
  return byCategory;
}

function selectOnePerCategory(
  categories: readonly SuggestionCategory[],
  byCategory: Map<SuggestionCategory, ExploreSuggestion[]>,
  targetCount: number,
  random: () => number,
): string[] {
  const selected: string[] = [];
  const selectedSet = new Set<string>();

  for (const cat of categories) {
    if (selected.length >= targetCount) break;
    const items = byCategory.get(cat);
    if (items === undefined || items.length === 0) continue;

    const idx = Math.floor(random() * items.length);
    const chosen = items[idx];
    if (chosen !== undefined && !selectedSet.has(chosen.prompt)) {
      selected.push(chosen.prompt);
      selectedSet.add(chosen.prompt);
    }
  }
  return selected;
}

export type PickSuggestionsOptions = {
  readonly count?: number;
  readonly exclude?: readonly string[];
  readonly random?: () => number;
};

/**
 * Select a diverse set of suggestions across different categories.
 */
export function pickDiverseSuggestions(
  suggestions: readonly ExploreSuggestion[],
  context: ExploreFeatureContext,
  options: PickSuggestionsOptions = {},
): string[] {
  const count = options.count ?? 4;
  if (count <= 0) return [];

  const eligible = filterSuggestions(suggestions, context);
  if (eligible.length === 0) return [];

  const excludeSet = new Set(options.exclude);
  const candidates = eligible.filter((s) => !excludeSet.has(s.prompt));
  const pool = candidates.length >= count ? candidates : eligible;
  const random = options.random ?? Math.random;

  const byCategory = groupByCategory(pool);
  const shuffledCategories = shuffle([...byCategory.keys()], random);
  const selected = selectOnePerCategory(
    shuffledCategories,
    byCategory,
    count,
    random,
  );

  if (selected.length < count) {
    const selectedSet = new Set(selected);
    const remaining = pool.filter((s) => !selectedSet.has(s.prompt));
    const shuffledRemaining = shuffle(remaining, random);
    for (const item of shuffledRemaining) {
      if (selected.length >= count) break;
      selected.push(item.prompt);
      selectedSet.add(item.prompt);
    }
  }

  return selected;
}
