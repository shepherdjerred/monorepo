/**
 * Small Zod-based helpers for narrowing untrusted JSON (registry/API/file
 * bodies) without type-guard functions, which the repo's
 * `custom-rules/no-type-guards` ESLint rule bans.
 */

import { z } from "zod";

const RecordSchema = z.record(z.string(), z.unknown());

/**
 * Return `value` as a string-keyed record, or null if it is not an object.
 * Use instead of a `value is Record<...>` type guard.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  const parsed = RecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Parse `value` into a `Record<string, string>`, keeping only string-valued
 * entries. Non-object input yields an empty record.
 */
export function toStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (record === null) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}
