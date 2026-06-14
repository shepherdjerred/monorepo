// Discord rejects any message payload longer than 2000 characters with a 400
// error, counting by Unicode code points rather than UTF-16 code units.
export const DISCORD_MESSAGE_LIMIT = 2000;

const TRUNCATION_INDICATOR = "… (truncated)";

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

// Count Unicode code points (what Discord measures against its limit).
function codePointLength(value: string): number {
  let length = 0;
  for (const _codePoint of value) {
    length += 1;
  }
  return length;
}

// Defang Discord mentions/markdown by inserting a zero-width space after `@`.
export function sanitizeDiscordText(value: string): string {
  return value.replaceAll("@", "@​");
}

// Truncate a message so it safely fits Discord's 2000-character limit. When the
// content is too long it is cut to leave room for a clear truncation indicator,
// which is then appended. Truncation happens on grapheme-cluster boundaries so
// emoji and combining marks are never split, while staying within the
// code-point budget Discord enforces. A never-fit limit (smaller than the
// indicator) still returns a string capped at the limit so callers can rely on
// the bound.
export function truncateForDiscord(
  content: string,
  limit: number = DISCORD_MESSAGE_LIMIT,
): string {
  if (codePointLength(content) <= limit) {
    return content;
  }

  const indicatorLength = codePointLength(TRUNCATION_INDICATOR);
  if (limit <= indicatorLength) {
    return truncateToGraphemes(TRUNCATION_INDICATOR, limit);
  }

  const keep = truncateToGraphemes(content, limit - indicatorLength);
  return `${keep}${TRUNCATION_INDICATOR}`;
}

// Keep whole grapheme clusters from the start of `value` while the accumulated
// code-point count stays within `budget`.
function truncateToGraphemes(value: string, budget: number): string {
  let result = "";
  let used = 0;
  for (const { segment } of graphemeSegmenter.segment(value)) {
    const cost = codePointLength(segment);
    if (used + cost > budget) {
      break;
    }
    result += segment;
    used += cost;
  }
  return result;
}
