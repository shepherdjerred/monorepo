export type RangeDecision =
  | { type: "full" }
  | { type: "partial"; start: number; end: number }
  | { type: "unsatisfiable" };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/u;

/**
 * Decides how to answer a `Range` header for a body of `size` bytes. One
 * range (closed, open-ended or suffix) gets a 206; a range past the end gets
 * a 416; a multi-range or malformed header is ignored and the whole body is
 * sent, which RFC 9110 allows.
 */
export function parseRange(header: string | null, size: number): RangeDecision {
  if (header === null) return { type: "full" };
  const match = SINGLE_RANGE.exec(header.trim());
  if (match === null) return { type: "full" };
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return { type: "full" };
  if (first === "") {
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix)) return { type: "full" };
    if (suffix === 0 || size === 0) return { type: "unsatisfiable" };
    return {
      type: "partial",
      start: Math.max(0, size - suffix),
      end: size - 1,
    };
  }
  const start = Number(first);
  if (!Number.isSafeInteger(start)) return { type: "full" };
  if (start >= size) return { type: "unsatisfiable" };
  if (last === "") return { type: "partial", start, end: size - 1 };
  const end = Number(last);
  return !Number.isSafeInteger(end) || end < start
    ? { type: "full" }
    : { type: "partial", start, end: Math.min(end, size - 1) };
}

/** `If-Range` with a strong validator: a mismatch means send the whole body. */
export function ifRangeMatches(header: string | null, etag: string): boolean {
  return header === null || header.trim() === etag;
}

/** Strong comparison of `If-None-Match`, which may list several tags or `*`. */
export function noneMatch(header: string | null, etag: string): boolean {
  const entries = header?.split(",").map((entry) => entry.trim());
  return (
    entries?.some(
      (entry) => entry === "*" || entry === etag || entry === `W/${etag}`,
    ) ?? false
  );
}
