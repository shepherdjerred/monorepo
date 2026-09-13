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

import { z } from "zod";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-lake.puuid-remap");

/** Written by `scripts/migrate-puuid-key.ts`; absent where no migration ran. */
const MAP_TABLE = "PuuidKeyMap";

const TablePresenceSchema = z.array(z.object({ present: z.boolean() }));
const RemapRowsSchema = z.array(
  z.object({ oldPuuid: z.string(), newPuuid: z.string() }),
);

/**
 * Loads the map, or an empty one where the table does not exist.
 *
 * Absence is a legitimate state, not a swallowed failure: an environment that
 * never crossed key domains has no old-domain PUUIDs to translate, so an empty
 * map is the correct answer. Existence is checked explicitly rather than by
 * catching a query error, so a genuine database fault still surfaces.
 */
export async function loadPuuidRemap(
  prisma: ExtendedPrismaClient,
): Promise<ReadonlyMap<string, string>> {
  const presence: unknown = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public."${MAP_TABLE}"') IS NOT NULL AS present`,
  );
  const [presenceRow] = TablePresenceSchema.parse(presence);
  if (presenceRow?.present !== true) {
    logger.info(
      `No ${MAP_TABLE} table; treating the corpus as single-domain and skipping remap`,
    );
    return new Map();
  }

  const rows: unknown = await prisma.$queryRawUnsafe(
    `SELECT "oldPuuid", "newPuuid" FROM "${MAP_TABLE}" WHERE "newPuuid" IS NOT NULL`,
  );
  const map = new Map<string, string>(
    RemapRowsSchema.parse(rows).map((r) => [r.oldPuuid, r.newPuuid]),
  );
  logger.info(
    `Loaded ${map.size.toString()} PUUID remappings for historical payloads`,
  );
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
