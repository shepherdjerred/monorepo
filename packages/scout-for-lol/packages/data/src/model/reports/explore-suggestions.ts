import { z } from "zod";
import rawSuggestions from "./explore-suggestions.json" with { type: "json" };

/**
 * The shipped Explore starter prompts, and the rule deciding which of them a
 * given set of capabilities may show.
 *
 * This lives in the data package rather than the web app because two consumers
 * need the same truth. The app renders the chips; the Explore replay eval
 * drives every one of them through the real agent and has to know, per
 * capability profile, whether a prompt was supposed to be answerable at all.
 * A second copy of the condition table in the backend would let the eval's
 * idea of "this should have been refused" drift away from what the product
 * actually offers, which is the one thing an eval must never do.
 *
 * The sampling that picks four chips for a screen stays in the app: it is a
 * presentation concern with no bearing on what is answerable.
 */

export const SuggestionCategorySchema = z.enum([
  "bucks",
  "mvp_votes",
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
  "mvp_votes",
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
  readonly mvpVotesEnabled?: boolean;
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
    case "mvp_votes":
      return context.mvpVotesEnabled ?? false;
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
