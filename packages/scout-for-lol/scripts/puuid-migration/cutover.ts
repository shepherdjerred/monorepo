/**
 * What state this database is in, and which identities that makes suspect.
 *
 * Three questions that only make sense together: has the rewrite already run
 * here, which tracked identities has the map never seen, and which of those
 * were genuinely skipped rather than simply registered after the cutover.
 * Answering any of them wrongly has produced a real failure on this migration,
 * so they live in one place with the reasoning attached.
 */

import type { Db } from "./db.ts";
import { readTrackedPuuids } from "./discovery.ts";
import { collectFromJson, parseJson, selectSubtree } from "./json-walk.ts";
import {
  asOptionalString,
  asString,
  countOf,
  toEpochMillis,
  TRACKED_SOURCES,
} from "./support.ts";

/**
 * Tracked identities the map has never seen, in either domain.
 *
 * Both sides count as known. This is used by verification, where a completed
 * mapping's replacement is the value the database should contain.
 *
 * What this still catches is the real hazard: an account registered after
 * `collect`, which has no map row at all and would otherwise be rewritten to
 * nothing and stranded.
 */
export async function knownIdentities(db: Db): Promise<Set<string>> {
  const rows = await db.query(
    `SELECT "oldPuuid", "newPuuid" FROM "PuuidKeyMap"`,
  );
  const known = new Set<string>();
  for (const row of rows) {
    known.add(asString(row["oldPuuid"], "oldPuuid"));
    const mapped = asOptionalString(row["newPuuid"]);
    if (mapped !== null) {
      known.add(mapped);
    }
  }
  return known;
}

/**
 * Identities collect may treat as already present during the current run.
 *
 * A replacement from a completed transition is intentionally omitted: after
 * `begin`, that value is the old-domain input for the next transition. A
 * replacement whose rewrite is still in flight remains known so an interrupted
 * apply can be resumed without creating a duplicate pending row.
 */
export async function collectKnownIdentities(db: Db): Promise<Set<string>> {
  const rows = await db.query(
    `SELECT "oldPuuid", "newPuuid", "appliedAt" FROM "PuuidKeyMap"`,
  );
  const known = new Set<string>();
  for (const row of rows) {
    known.add(asString(row["oldPuuid"], "oldPuuid"));
    const mapped = asOptionalString(row["newPuuid"]);
    if (mapped !== null && row["appliedAt"] === null) {
      known.add(mapped);
    }
  }
  return known;
}

async function unmappedTrackedIdentities(db: Db): Promise<string[]> {
  const tracked = await readTrackedPuuids(db);
  const known = await knownIdentities(db);
  return [...tracked].filter((puuid) => !known.has(puuid));
}

/** Whether `apply` has finished rewriting this database to the new domain. */
export async function cutoverApplied(db: Db): Promise<boolean> {
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMigration" WHERE "appliedAt" IS NOT NULL`,
  );
  return countOf(rows, "cutover marker") > 0;
}

/**
 * Start a new key transition without discarding the old remap history.
 *
 * The marker describes the current transition, while the map rows retain every
 * previous transition so backups can still be translated. Resetting the marker
 * is therefore the transition boundary; it is explicit because doing it after
 * a completed cutover changes how `collect` judges new rows.
 */
export async function beginTransition(
  db: Db,
  newTransition: boolean,
): Promise<void> {
  if (!(await cutoverApplied(db))) {
    console.log("begin: no completed cutover; starting the first transition");
    return;
  }
  if (!newTransition) {
    throw new Error(
      "this database already has a completed cutover; pass --new-transition to begin another key transition",
    );
  }
  const incomplete = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMap"
      WHERE "status" <> 'stranded'
        AND ("status" <> 'resolved' OR "appliedAt" IS NULL)`,
  );
  if (countOf(incomplete, "incomplete mapping") > 0) {
    throw new Error(
      "cannot begin a new transition while the previous map has unresolved work",
    );
  }
  await db.exec(
    `UPDATE "PuuidKeyMigration" SET "appliedAt" = NULL WHERE "id" = 1`,
  );
  console.log(
    "begin: previous remap history retained; current transition marker reset",
  );
}

/**
 * Tracked identities that should have been migrated and were not.
 *
 * Before the cutover, any unmapped tracked identity is missed work. After it,
 * most are not: an identity registered since is already new-domain and is
 * deliberately absent from the map, which is why `collect` refuses to record
 * one. Only one that predates the cutover and is still unmapped was actually
 * skipped — so the marker's timestamp, not its mere presence, separates them.
 */
export async function strayIdentities(db: Db): Promise<string[]> {
  const unmapped = await unmappedTrackedIdentities(db);
  if (unmapped.length === 0) {
    return unmapped;
  }
  const markerRows = await db.query(
    `SELECT "appliedAt" AS v FROM "PuuidKeyMigration" WHERE "id" = 1 AND "appliedAt" IS NOT NULL`,
  );
  const marker = markerRows[0];
  if (marker === undefined) {
    return unmapped;
  }
  const appliedAt = toEpochMillis(marker["v"], "cutover marker");
  const firstSeen = await earliestSighting(db);

  return unmapped.filter((puuid) => {
    const seen = firstSeen.get(puuid);
    // Undatable identities stay suspect rather than being excused by a missing
    // timestamp, and the boundary is inclusive: one first seen in the instant
    // the marker was written raced the rewrite. Flagging a healthy identity
    // fails a verify an operator can investigate; excusing a raced one strands
    // it against a key about to be retired.
    return seen === undefined || seen <= appliedAt;
  });
}

/**
 * The earliest moment each tracked identity was seen, across every source.
 *
 * Dating from `Account` alone was wrong: `MatchTrackedAccount` records an
 * association with no account row and outlives account deletion, so an ordinary
 * post-cutover identity had no date at all and was held as a stray forever.
 *
 * Comparison happens here rather than in SQL because these columns disagree on
 * representation — the promoted SQLite image stores `createdTime` as epoch
 * milliseconds while other sources store timestamps, and SQLite orders every
 * integer before every text value regardless of the dates they encode.
 *
 * Earliest wins: an identity seen anywhere before the cutover predates it,
 * whichever table still happens to hold it.
 */
/** Every identity one source names, paired with when that row recorded it. */
async function sightingsFrom(
  db: Db,
  source: (typeof TRACKED_SOURCES)[number],
): Promise<{ puuid: string; at: number }[]> {
  const filter = source.where === undefined ? "" : ` AND ${source.where}`;
  const rows = await db.query(
    `SELECT "${source.column}" AS v, "${source.createdColumn}" AS t FROM "${source.table}" WHERE "${source.createdColumn}" IS NOT NULL${filter}`,
  );
  const sightings: { puuid: string; at: number }[] = [];
  for (const row of rows) {
    const value = asOptionalString(row["v"]);
    const stamp = row["t"];
    if (value === null || stamp === null || stamp === undefined) {
      continue;
    }
    const at = toEpochMillis(stamp, `${source.table}.${source.createdColumn}`);
    if (!source.json) {
      sightings.push({ puuid: value, at });
      continue;
    }
    // One row timestamps every identity it names, within the part of the
    // document that actually drives behaviour.
    const parsed = parseJson(value);
    const scope =
      source.jsonPath === undefined
        ? parsed
        : selectSubtree(parsed, source.jsonPath);
    if (scope === undefined) {
      continue;
    }
    const named: string[] = [];
    collectFromJson(scope, source.bareArray, named);
    for (const puuid of named) {
      sightings.push({ puuid, at });
    }
  }
  return sightings;
}

async function earliestSighting(db: Db): Promise<Map<string, number>> {
  const tables = new Set(await db.listTables());
  const earliest = new Map<string, number>();

  for (const source of TRACKED_SOURCES) {
    if (!tables.has(source.table)) {
      continue;
    }
    for (const { puuid, at } of await sightingsFrom(db, source)) {
      const previous = earliest.get(puuid);
      if (previous === undefined || at < previous) {
        earliest.set(puuid, at);
      }
    }
  }
  return earliest;
}
