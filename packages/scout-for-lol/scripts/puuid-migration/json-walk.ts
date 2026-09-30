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
 *
 * A string counts when its key ends in `puuid`, which covers both the bare
 * `puuid` and qualified names like `sourcePuuid`.
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
    // Any key ENDING in "puuid", not just the bare word. A Dare activation
    // snapshot freezes its subject under `sourcePuuid`, and an exact match
    // silently walked past it — the column would have been registered and
    // rewritten while contributing no identity to migrate, so the audit would
    // then abort on an identifier nothing had collected. The suffix rule
    // matches the one already used for `*Puuids` arrays.
    if (typeof child === "string" && key.toLowerCase().endsWith("puuid")) {
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

/**
 * Narrow a payload to one named subtree before collecting from it.
 *
 * Some stored documents mix identities that matter with identities that merely
 * appeared. A queued Temporal job carries the tracked players it will act on
 * AND the full participant lists of the game it describes; collecting the whole
 * payload pulls in every opponent, which both inflates the migration and lets an
 * unrelated stranger who no longer resolves block the rewrite entirely.
 */
export function selectSubtree(value: Json, key: string): Json | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return Object.hasOwn(value, key) ? value[key] : undefined;
}
