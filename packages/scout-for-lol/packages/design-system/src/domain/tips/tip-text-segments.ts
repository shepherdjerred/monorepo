import type { TextRef } from "@scout-for-lol/data/tips/output/champion-tips.ts";

export type TipTextSegment =
  | { type: "text"; start: number; text: string }
  | { type: "ref"; start: number; text: string; ref: TextRef };

/**
 * Cuts a generated text into plain runs and referenced phrases, in order.
 *
 * The output schema only promises a non-empty span; the generator's validator
 * and the CI check (`fileIssues`) promise that each span lies inside its text
 * and that none overlap. A span that breaks the second promise is a broken
 * contract, not something to render around, so it throws instead of dropping
 * or clipping the phrase. References may arrive in any order.
 */
export function splitTipText(
  text: string,
  refs: readonly TextRef[],
): TipTextSegment[] {
  const ordered = refs.toSorted((left, right) => left.start - right.start);
  const segments: TipTextSegment[] = [];
  let cursor = 0;
  for (const ref of ordered) {
    const label = `${ref.kind}/${ref.key} (${ref.start.toString()}-${ref.end.toString()})`;
    if (ref.end > text.length) {
      throw new Error(
        `Tip reference ${label} runs past the ${text.length.toString()} characters of "${text}"`,
      );
    }
    if (ref.start < cursor) {
      throw new Error(
        `Tip reference ${label} overlaps the one before it in "${text}"`,
      );
    }
    if (ref.start > cursor) {
      segments.push({
        type: "text",
        start: cursor,
        text: text.slice(cursor, ref.start),
      });
    }
    segments.push({
      type: "ref",
      start: ref.start,
      text: text.slice(ref.start, ref.end),
      ref,
    });
    cursor = ref.end;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", start: cursor, text: text.slice(cursor) });
  }
  return segments;
}
