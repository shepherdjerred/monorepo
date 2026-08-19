import type { BucksPrediction } from "@scout-for-lol/data";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";
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
  const prediction =
    input.prediction !== undefined &&
    shouldDisplayPrediction(input.prediction.winProbability)
      ? `${input.prediction.sentence}\n`
      : "";
  return `${prediction}${HOUSE_CUT_TERMS}`;
}

/**
 * Append the betting footer to a message, truncating the base if needed so an
 * open market never loses its house-cut disclosure.
 *
 * The footer is internal, bounded copy. If it alone cannot fit, that is a
 * broken caller contract and must fail loudly rather than sending partial
 * terms.
 */
export function appendBucksLine(base: string, footer: string): string {
  if (footer.length === 0) {
    return base;
  }
  const combined = `${base}\n\n${footer}`;
  if (combined.length <= MAX_CONTENT_LENGTH) {
    return combined;
  }
  const baseLength = MAX_CONTENT_LENGTH - footer.length - 2;
  if (baseLength < 0) {
    throw new Error("Bryan Bucks prematch footer exceeds Discord's limit");
  }
  return `${base.slice(0, baseLength)}\n\n${footer}`;
}
