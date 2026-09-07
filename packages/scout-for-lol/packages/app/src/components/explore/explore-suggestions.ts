import { z } from "zod";
import rawSuggestions from "./explore-suggestions.json" with { type: "json" };

export const SuggestionCategorySchema = z.enum([
  "bucks",
  "competitions",
  "hall_of_fame",
  "customs",
  "challenges",
  "creation",
  "champions",
  "roles",
  "queues",
  "players",
  "trivia",
]);

export type SuggestionCategory = z.infer<typeof SuggestionCategorySchema>;

export const SuggestionConditionSchema = z.enum([
  "always",
  "bucks",
  "dares",
  "competitions",
  "hall_of_fame",
  "customs",
  "challenges",
  "reports",
]);

export type SuggestionCondition = z.infer<typeof SuggestionConditionSchema>;

export const ExploreSuggestionSchema = z.object({
  prompt: z.string().min(1),
  category: SuggestionCategorySchema,
  condition: SuggestionConditionSchema,
});

export type ExploreSuggestion = z.infer<typeof ExploreSuggestionSchema>;

export const PERSISTENT_EXPLORE_SUGGESTION = "What can you do?";

export type ExploreFeatureContext = {
  readonly bucksEnabled?: boolean;
  readonly daresEnabled?: boolean;
  readonly competitionsEnabled?: boolean;
  readonly reportsEnabled?: boolean;
  readonly customsEnabled?: boolean;
  readonly hallOfFameEnabled?: boolean;
  readonly challengesEnabled?: boolean;
};

export const EXPLORE_SUGGESTIONS: readonly ExploreSuggestion[] = z
  .array(ExploreSuggestionSchema)
  .parse(rawSuggestions);

export function isSuggestionEligible(
  suggestion: ExploreSuggestion,
  context: ExploreFeatureContext,
): boolean {
  switch (suggestion.condition) {
    case "always":
      return true;
    case "bucks":
      return context.bucksEnabled ?? false;
    case "dares":
      return context.daresEnabled ?? false;
    case "competitions":
      return context.competitionsEnabled ?? false;
    case "reports":
      return context.reportsEnabled ?? false;
    case "customs":
      return context.customsEnabled ?? false;
    case "hall_of_fame":
      return context.hallOfFameEnabled ?? false;
    case "challenges":
      return context.challengesEnabled ?? false;
  }
}

/**
 * Filter suggestions to those matching the user's enabled capabilities.
 */
export function filterSuggestions(
  suggestions: readonly ExploreSuggestion[],
  context: ExploreFeatureContext,
): ExploreSuggestion[] {
  return suggestions.filter((suggestion) =>
    isSuggestionEligible(suggestion, context),
  );
}

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
