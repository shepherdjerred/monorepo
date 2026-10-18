// Length budgets here are UTF-16 code units (`String#length`), the unit every
// JavaScript limit check and Zod `.max()` already uses. Cuts only ever land on
// grapheme cluster boundaries, so a result never ends in half a surrogate pair
// or part of an emoji sequence, flag, or combining-mark cluster.

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export const DEFAULT_TRUNCATION_INDICATOR = "…";

function assertBudget(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative integer, got ${String(value)}`,
    );
  }
}

/**
 * The longest prefix of `text` made of whole grapheme clusters whose length
 * is at most `maxLength` code units.
 */
export function graphemePrefix(text: string, maxLength: number): string {
  assertBudget("maxLength", maxLength);
  if (text.length <= maxLength) {
    return text;
  }
  let prefix = "";
  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (prefix.length + segment.length > maxLength) {
      break;
    }
    prefix += segment;
  }
  return prefix;
}

/**
 * Returns `text` unchanged when it fits in `maxLength` code units. Otherwise
 * keeps whole grapheme clusters and appends `indicator`, with the result,
 * indicator included, still at most `maxLength` code units.
 */
export function truncateGraphemes(
  text: string,
  maxLength: number,
  indicator: string = DEFAULT_TRUNCATION_INDICATOR,
): string {
  assertBudget("maxLength", maxLength);
  if (text.length <= maxLength) {
    return text;
  }
  if (indicator.length > maxLength) {
    throw new RangeError(
      `indicator (${String(indicator.length)} units) exceeds maxLength ${String(maxLength)}`,
    );
  }
  return `${graphemePrefix(text, maxLength - indicator.length)}${indicator}`;
}

/** The first `count` grapheme clusters of `text`, such as an avatar initial. */
export function firstGraphemes(text: string, count: number): string {
  assertBudget("count", count);
  let prefix = "";
  let taken = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (taken === count) {
      break;
    }
    prefix += segment;
    taken += 1;
  }
  return prefix;
}

/**
 * Splits `text` into consecutive chunks of at most `maxLength` code units,
 * never inside a grapheme cluster. A single cluster longer than `maxLength`
 * (such as a long run of combining marks) is split between code points, so
 * every chunk stays well formed. Joining the chunks reproduces `text`.
 */
export function chunkGraphemes(text: string, maxLength: number): string[] {
  assertBudget("maxLength", maxLength);
  if (maxLength === 0) {
    throw new RangeError("maxLength must be positive to chunk text");
  }
  if (text.length <= maxLength) {
    return text === "" ? [] : [text];
  }
  const chunks: string[] = [];
  let current = "";
  const append = (piece: string): void => {
    if (current.length + piece.length > maxLength) {
      chunks.push(current);
      current = "";
    }
    current += piece;
  };
  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (segment.length <= maxLength) {
      append(segment);
      continue;
    }
    if (maxLength === 1) {
      throw new RangeError(
        "maxLength 1 cannot hold a code point outside the Basic Multilingual Plane",
      );
    }
    for (const codePoint of segment) {
      append(codePoint);
    }
  }
  if (current !== "") {
    chunks.push(current);
  }
  return chunks;
}
