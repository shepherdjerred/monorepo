import type { BucksPrediction } from "@scout-for-lol/data";
import { shouldDisplayPrediction } from "#src/betting/prediction.ts";

/**
 * The Bryan Bucks lines appended to a prematch message.
 *
 * Kept separate from the notification module so the text can be unit-tested
 * without a Discord client, and so the length rule below lives next to the
 * strings it governs.
 */

/** Discord's hard limit on message content. */
const MAX_CONTENT_LENGTH = 2000;

/**
 * Build the optional betting line.
 *
 * A prediction close to even odds is deliberately omitted: the buttons are
 * useful, but a nearly arbitrary call is not useful to read.
 */
export function bucksPrematchLine(input: {
  prediction: BucksPrediction | undefined;
}): string {
  return input.prediction !== undefined &&
    shouldDisplayPrediction(input.prediction.winProbability)
    ? input.prediction.sentence
    : "";
}

/**
 * Append the betting footer to a message, dropping it entirely rather than
 * truncating if it would overflow.
 *
 * The base sentence — who started a game — is the core product output and must
 * survive. A half-truncated prediction is worse than no prediction, so the
 * footer is all-or-nothing.
 */
export function appendBucksLine(base: string, footer: string): string {
  if (footer.length === 0) {
    return base;
  }
  const combined = `${base}\n\n${footer}`;
  if (combined.length <= MAX_CONTENT_LENGTH) {
    return combined;
  }
  return base.slice(0, MAX_CONTENT_LENGTH);
}
