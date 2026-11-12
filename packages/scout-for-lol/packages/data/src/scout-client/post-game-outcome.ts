import { z } from "zod";

/**
 * What became of one Scout Client post-game observation. The closed set metrics
 * label by and a status endpoint reports; a new outcome is added here first so
 * every consumer fails to compile until it handles it.
 *
 * - `complete`: the bundle converted to a full match and is dispatched live.
 * - `end_of_game`: only the end-of-game stats arrived, short of a full match.
 * - `unsupported_mode`: the bundle names a game Scout cannot convert.
 * - `waiting_identity`: the observer's League-client UUID has no Riot alias yet.
 * - `historical`: too old to announce; stored and archived without a post.
 */
export const ScoutClientPostGameOutcomeSchema = z.enum([
  "complete",
  "end_of_game",
  "unsupported_mode",
  "waiting_identity",
  "historical",
]);
export type ScoutClientPostGameOutcome = z.infer<
  typeof ScoutClientPostGameOutcomeSchema
>;

/** The facts about one post-game observation that decide its outcome. */
export type ScoutClientPostGameProcessingState = {
  /** Whether the observer's League-client UUID is resolved to a Riot PUUID. */
  readonly identityResolved: boolean;
  /** How much of a match the bundle converted to. */
  readonly conversion: "complete" | "end_of_game_only" | "unsupported";
  /** The delivery decision, or `null` when the bundle is not deliverable. */
  readonly deliveryMode: "live" | "silent-backfill" | null;
};

/**
 * The single projection from processing state to outcome. Identity gates
 * everything (nothing else can be known without it), then age, then whether
 * the bundle is convertible at all.
 */
export function projectPostGameOutcome(
  state: ScoutClientPostGameProcessingState,
): ScoutClientPostGameOutcome {
  if (!state.identityResolved) return "waiting_identity";
  if (state.deliveryMode === "silent-backfill") return "historical";
  switch (state.conversion) {
    case "unsupported":
      return "unsupported_mode";
    case "end_of_game_only":
      return "end_of_game";
    case "complete":
      return "complete";
  }
}
