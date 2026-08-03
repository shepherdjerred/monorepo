import { z } from "zod";

/**
 * Integer that clamps out-of-range values into [min, max] instead of
 * rejecting. LLM tool input is boundary input: a range overshoot (e.g.
 * searchRadius 21, tiles 999, repeat 0) is a routine agent misfire whose
 * intent is clear, so forgive the range while still hard-failing wrong
 * types (floats, strings, null).
 */
export function clampedInt(min: number, max: number) {
  return z
    .number()
    .int()
    .transform((value) => Math.min(max, Math.max(min, value)));
}

/**
 * Case- and whitespace-forgiving enum. `values` are the lowercase canonical
 * forms; any casing of them ("North", " EAST ") parses to the canonical
 * value, so the output type is unchanged for callers.
 */
export function caseInsensitiveEnum<
  const T extends readonly [string, ...string[]],
>(values: T) {
  return z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(values));
}
