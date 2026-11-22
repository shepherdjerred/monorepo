import {
  EXPLORE_MAX_OUTPUT_TOKENS,
  EXPLORE_MAX_STEPS,
  type CoachGameContext,
} from "@scout-for-lol/data";

/**
 * How hard a coach turn may work, chosen server-side from what the turn
 * carries, never from a client field. The one profile every coach surface
 * shares: a typed question, an app-started champion-select turn and a spoken
 * question all run it when their projected context puts the player in
 * champion select or a game.
 *
 * A player in champion select or in a game is waiting on the answer, so those
 * turns run the in-game profile: a fast model at low reasoning effort, six
 * steps and 1,200 output tokens, admitted by the in-game allowance instead of
 * Explore's question windows. A plan at the loading screen or a review of a
 * finished game is not time-pressed and runs the ordinary Explore settings
 * (`null`).
 */
export type CoachExecutionProfile = {
  readonly name: "in_game";
  /** The model the profile pins, whatever the conversation prefers. */
  readonly model: string;
  readonly reasoningEffort: "low";
  readonly maxSteps: number;
  readonly maxOutputTokens: number;
};

/**
 * The in-game model: `gpt-6-luna`. Of the catalog's tool-calling,
 * structured-output models it is the cheapest ($0.10 in, $0.50 out per
 * million tokens; only `claude-haiku-5-5` ties it) and is described as the
 * fast GPT-6 tier for bounded companion conversations, which an in-game
 * question is. It is Explore's own default, so the agent's tools and answer
 * schema are already proven on it, and the OpenAI path honours the low
 * effort this profile sends. Ultrafast serves only Sol and Astra, at 20 to
 * 100 times its token price.
 */
export const IN_GAME_MODEL = "gpt-6-luna";

export const IN_GAME_PROFILE: CoachExecutionProfile = {
  name: "in_game",
  model: IN_GAME_MODEL,
  reasoningEffort: "low",
  maxSteps: 6,
  maxOutputTokens: 1200,
};

/** The sections whose presence puts a turn in the in-game profile. */
export const IN_GAME_SECTIONS = ["champSelect", "live"] as const;

/** The profile for a turn's projected game context; null for the Explore defaults. */
export function coachExecutionProfile(
  context: CoachGameContext | null | undefined,
): CoachExecutionProfile | null {
  if (context === null || context === undefined) return null;
  // A pre-game plan or a post-game review reads as a document, not a reply.
  if (context.pregame !== undefined || context.postgame !== undefined) {
    return null;
  }
  return context.champSelect === undefined && context.live === undefined
    ? null
    : IN_GAME_PROFILE;
}

/** What a turn runs with: the profile's model and limits, or Explore's. */
export type CoachRunSettings = {
  /** The pinned model, or null to keep the turn's own. */
  readonly model: string | null;
  readonly reasoningEffort: "low" | "high";
  readonly maxSteps: number;
  readonly maxOutputTokens: number;
  /**
   * Which allowance admits the turn: an in-game turn has its own
   * (`IN_GAME_COACH_QUOTA_RULES` in `temporal/durable-quota.ts`), so Explore's
   * per-hour question limit cannot cut a player off mid-game.
   */
  readonly quota: "explore" | "in_game";
};

export function coachRunSettings(
  context: CoachGameContext | null | undefined,
): CoachRunSettings {
  const profile = coachExecutionProfile(context);
  return {
    model: profile?.model ?? null,
    reasoningEffort: profile?.reasoningEffort ?? "high",
    maxSteps: profile?.maxSteps ?? EXPLORE_MAX_STEPS,
    maxOutputTokens: profile?.maxOutputTokens ?? EXPLORE_MAX_OUTPUT_TOKENS,
    quota: profile === null ? "explore" : "in_game",
  };
}
