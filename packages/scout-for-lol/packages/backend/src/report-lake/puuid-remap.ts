/**
 * Old→new PUUID remapping for historical raw payloads.
 *
 * Riot encrypts PUUIDs per API-key holder, so moving Scout from the
 * personal-tier key to the production key changed every tracked player's
 * PUUID. The database was rewritten in place, but the S3 corpus is the
 * canonical record of what Riot actually returned and is deliberately left
 * untouched — which means every historical `match.json`, `timeline.json`, and
 * `spectator-data.json` still carries old-domain PUUIDs, permanently.
 *
 * The report lake is derived from that corpus. Re-deriving it without
 * translation would reproduce old-domain PUUIDs in fresh Parquet and silently
 * split one player into two identities across the cutover date — no error,
 * just wrong aggregates. So the map is applied when raw payloads are read,
 * before validation and flattening.
 *
 * `accountToLakeRow` needs no remapping: it reads the database, which is
 * already re-domained.
 */

import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-lake.puuid-remap");

/**
 * Loads the old→new mapping for every identity that was successfully migrated.
 *
 * An empty result is a legitimate state, not a swallowed failure: an
 * environment that never crossed key domains has no old-domain PUUIDs to
 * translate. Unresolved rows are excluded because they have no replacement —
 * their historical payloads keep old-domain identifiers by design.
 */
export async function loadPuuidRemap(
  prisma: ExtendedPrismaClient,
): Promise<ReadonlyMap<string, string>> {
  const rows = await prisma.puuidKeyMap.findMany({
    where: { newPuuid: { not: null } },
    select: { oldPuuid: true, newPuuid: true },
  });

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.newPuuid === null) {
      continue;
    }
    map.set(row.oldPuuid, row.newPuuid);
  }
  if (map.size > 0) {
    logger.info(
      `Loaded ${map.size.toString()} PUUID remappings for historical payloads`,
    );
  }
  return map;
}

/**
 * Replace every known old-domain PUUID anywhere in a parsed payload.
 *
 * Structural rather than schema-shaped: Riot payloads carry PUUIDs in
 * participant arrays, metadata id lists, and per-frame timeline objects, and
 * the shapes differ between match, timeline, and spectator documents. Any
 * string the map knows is an old PUUID is safe to replace wherever it appears.
 */
export function remapRawJson(
  value: unknown,
  map: ReadonlyMap<string, string>,
): unknown {
  if (map.size === 0) {
    return value;
  }
  if (typeof value === "string") {
    return map.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapRawJson(item, map));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries({ ...value }).map(([key, child]) => [
      key,
      remapRawJson(child, map),
    ]),
  );
}

/**
 * Identifies the PUUID domain a lake build was written at.
 *
 * The fold tier hardlinks the published build's parquet and appends only new
 * files, so it cannot retranslate history. Without this, deploying the remap
 * over a pre-cutover lake would leave match rows on old-domain PUUIDs while
 * accounts — refreshed from the re-domained database — moved to new ones,
 * hiding historical results until the next full rebuild happened to run.
 *
 * Folding the remap into the build fingerprint reuses the machinery that
 * already exists for column changes: a fingerprint mismatch makes the fold fall
 * back to a full rebuild, which rewrites every file through the map.
 */
export function puuidRemapFingerprint(
  map: ReadonlyMap<string, string>,
): string {
  if (map.size === 0) {
    return "none";
  }
  const hasher = new Bun.CryptoHasher("sha256");
  for (const [oldPuuid, newPuuid] of [...map.entries()].toSorted(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    hasher.update(`${oldPuuid}>${newPuuid}\n`);
  }
  return hasher.digest("hex").slice(0, 16);
}
