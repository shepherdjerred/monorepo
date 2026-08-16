import type { BucksPrediction } from "@scout-for-lol/data";

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
 * Build the betting footer.
 *
 * `<t:…:R>` renders a live countdown in every reader's own locale and costs
 * nothing to keep current — far better than baking a wall-clock time into the
 * text and letting it go stale the moment it is posted.
 */
export function bucksPrematchLine(input: {
  closesAt: Date;
  prediction: BucksPrediction | undefined;
}): string {
  const closesAtUnix = Math.floor(input.closesAt.getTime() / 1000);
  const lines: string[] = [];

  if (input.prediction !== undefined) {
    lines.push(input.prediction.sentence);
  }
  lines.push(
    `Bets close <t:${closesAtUnix.toString()}:R> · \`/bb balance\` · 1:10 BB:CAD, in person only`,
  );

  return lines.join("\n");
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
  const combined = `${base}\n\n${footer}`;
  if (combined.length <= MAX_CONTENT_LENGTH) {
    return combined;
  }
  return base.slice(0, MAX_CONTENT_LENGTH);
}
