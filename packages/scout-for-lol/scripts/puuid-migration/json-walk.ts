/**
 * Recursive JSON traversal for PUUID collection and rewriting.
 *
 * Scout stores PUUIDs inside JSON at several depths: a bare array of strings
 * (`ActiveGame.trackedPuuids`), an array of objects (`BucksMatchPool.roster`),
 * a single object (`BucksLedgerEntry.context`), and nested contracts where
 * targets wrap accounts wrap puuids (`BucksDareV2.contractJson`). Writing a
 * schema per shape would break the first time one of those contracts changes,
 * so the walk is structural instead.
 *
 * The two directions are deliberately asymmetric:
 *
 * - Collection is CONSERVATIVE. It takes a string only when it sits under a
 *   `puuid` key, or is an element of an array in a column named `*Puuids`.
 *   Guessing wrong here would send junk to Riot.
 * - Rewriting is COMPLETE. It replaces any string already known to be an
 *   old-domain PUUID, wherever it appears. Once the map says a value is an old
 *   PUUID, replacing it is correct at any depth and under any key.
 */

import { z } from "zod";

export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };

export const JsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonSchema),
    z.record(z.string(), JsonSchema),
  ]),
);

export function parseJson(value: string): Json {
  const parsed: unknown = JSON.parse(value);
  return JsonSchema.parse(parsed);
}

/**
 * Collect PUUIDs from a parsed value. `bareArrayIsPuuids` is set for columns
 * like `trackedPuuids` whose arrays hold PUUID strings with no enclosing key.
 */
export function collectFromJson(
  value: Json,
  bareArrayIsPuuids: boolean,
  out: string[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        if (bareArrayIsPuuids) {
          out.push(item);
        }
        continue;
      }
      collectFromJson(item, bareArrayIsPuuids, out);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && key.toLowerCase() === "puuid") {
      out.push(child);
      continue;
    }
    collectFromJson(child, bareArrayIsPuuids, out);
  }
}

/** Replace every known old-domain PUUID, at any depth. */
export function translateJsonValue(
  value: Json,
  map: ReadonlyMap<string, string>,
): Json {
  if (typeof value === "string") {
    return map.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => translateJsonValue(item, map));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      translateJsonValue(child, map),
    ]),
  );
}
