import {
  EXPLORE_MAX_OUTPUT_TOKENS,
  EXPLORE_MAX_STEPS,
  ExploreAnswerWireSchema,
  type ExploreAnswer,
} from "@scout-for-lol/data";
import { assertEligibleExploreMatchCardRequests } from "#src/explore-match/match-view.ts";
import { assertEligibleExploreLoadoutCardRequests } from "#src/explore-match/loadout-view.ts";
import { ExploreCardSelectionError } from "#src/explore-match/card-selection-error.ts";

export const ExploreCardSelectionSchema = ExploreAnswerWireSchema.pick({
  matchCards: true,
  loadoutCards: true,
});

export type ExploreCardSelection = Pick<
  ExploreAnswer,
  "matchCards" | "loadoutCards"
>;

type CardEligibility = {
  eligibleMatchIds: Set<string>;
  eligibleLoadoutPairs: Set<string>;
};

function assertEligible(
  selection: ExploreCardSelection,
  eligibility: CardEligibility,
): void {
  assertEligibleExploreMatchCardRequests({
    requests: selection.matchCards,
    eligibleMatchIds: eligibility.eligibleMatchIds,
  });
  assertEligibleExploreLoadoutCardRequests({
    requests: selection.loadoutCards,
    eligiblePairs: eligibility.eligibleLoadoutPairs,
  });
}

/** One final-output correction; no tools, fresh deadline, or reset budgets. */
export async function repairExploreCardSelection(
  input: CardEligibility & {
    selection: ExploreCardSelection;
    stepsUsed: number;
    outputTokensUsed: number;
    /** The turn's step and output limits; Explore's own when omitted. */
    limits?: { readonly maxSteps: number; readonly maxOutputTokens: number };
    abortSignal: AbortSignal | undefined;
    correct: (request: {
      selection: ExploreCardSelection;
      failure: ExploreCardSelectionError;
      maxOutputTokens: number;
      abortSignal: AbortSignal | undefined;
    }) => Promise<ExploreCardSelection>;
  },
): Promise<ExploreCardSelection> {
  try {
    assertEligible(input.selection, input);
    return input.selection;
  } catch (error: unknown) {
    if (!(error instanceof ExploreCardSelectionError)) throw error;
    const limits = input.limits ?? {
      maxSteps: EXPLORE_MAX_STEPS,
      maxOutputTokens: EXPLORE_MAX_OUTPUT_TOKENS,
    };
    const remainingTokens = limits.maxOutputTokens - input.outputTokensUsed;
    if (input.stepsUsed >= limits.maxSteps || remainingTokens <= 0) throw error;
    input.abortSignal?.throwIfAborted();
    const corrected = ExploreCardSelectionSchema.parse(
      await input.correct({
        selection: input.selection,
        failure: error,
        maxOutputTokens: remainingTokens,
        abortSignal: input.abortSignal,
      }),
    );
    assertEligible(corrected, input);
    return corrected;
  }
}
