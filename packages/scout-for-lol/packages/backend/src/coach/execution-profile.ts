import {
  EXPLORE_MAX_OUTPUT_TOKENS,
  EXPLORE_MAX_STEPS,
  type CoachGameContext,
} from "@scout-for-lol/data";

/**
 * How hard a coach turn may work, chosen server-side from what the turn
 * carries, never from a client field.
 *
 * A player in champion select or in a game is waiting on the answer, so those
 * turns run the in-game profile: low reasoning effort, six steps and 1,200
 * output tokens. A plan at the loading screen or a review of a finished game
 * is not time-pressed and runs the ordinary Explore settings (`null`).
 */
export type CoachExecutionProfile = {
  readonly name: "in_game";
  readonly reasoningEffort: "low";
  readonly maxSteps: number;
  readonly maxOutputTokens: number;
};

export const IN_GAME_PROFILE: CoachExecutionProfile = {
  name: "in_game",
  reasoningEffort: "low",
  maxSteps: 6,
  maxOutputTokens: 1200,
};

/** The profile for a turn's projected game context; null for the Explore defaults. */
export function coachExecutionProfile(
  context: CoachGameContext | null | undefined,
): CoachExecutionProfile | null {
  if (context === null || context === undefined) return null;
  // A pre-game plan or a post-game review reads as a document, not a reply.
  if (context.pregame !== undefined || context.postgame !== undefined) {
    return null;
  }
  return context.champSelect !== undefined || context.live !== undefined
    ? IN_GAME_PROFILE
    : null;
}

/** What a turn runs with: the profile's limits, or the Explore defaults. */
export type CoachRunSettings = {
  readonly reasoningEffort: "low" | "high";
  readonly maxSteps: number;
  readonly maxOutputTokens: number;
};

export function coachRunSettings(
  context: CoachGameContext | null | undefined,
): CoachRunSettings {
  const profile = coachExecutionProfile(context);
  return {
    reasoningEffort: profile?.reasoningEffort ?? "high",
    maxSteps: profile?.maxSteps ?? EXPLORE_MAX_STEPS,
    maxOutputTokens: profile?.maxOutputTokens ?? EXPLORE_MAX_OUTPUT_TOKENS,
  };
}
