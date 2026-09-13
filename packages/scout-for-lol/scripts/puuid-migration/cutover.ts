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
import { collectFromJson, parseJson } from "./json-walk.ts";
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
 * Both sides count as known. A rerun after an interrupted apply finds rows that
 * earlier statements already rewrote — the Postgres path has no enclosing
 * transaction, by design, so a partial apply is expected and resumable. Judging
 * only by `oldPuuid` would classify those already-migrated rows as strangers and
 * abort exactly where resumability is supposed to work.
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

export async function unmappedTrackedIdentities(db: Db): Promise<string[]> {
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
async function earliestSighting(db: Db): Promise<Map<string, number>> {
  const tables = new Set(await db.listTables());
  const earliest = new Map<string, number>();

  const record = (puuid: string, at: number): void => {
    const previous = earliest.get(puuid);
    if (previous === undefined || at < previous) {
      earliest.set(puuid, at);
    }
  };

  for (const source of TRACKED_SOURCES) {
    if (!tables.has(source.table)) {
      continue;
    }
    const rows = await db.query(
      `SELECT "${source.column}" AS v, "${source.createdColumn}" AS t FROM "${source.table}" WHERE "${source.createdColumn}" IS NOT NULL`,
    );
    for (const row of rows) {
      const value = asOptionalString(row["v"]);
      const stamp = row["t"];
      if (value === null || stamp === null || stamp === undefined) {
        continue;
      }
      const at = toEpochMillis(
        stamp,
        `${source.table}.${source.createdColumn}`,
      );
      if (source.json) {
        // One row timestamps every identity it names.
        const inRow: string[] = [];
        collectFromJson(parseJson(value), true, inRow);
        for (const puuid of inRow) {
          record(puuid, at);
        }
        continue;
      }
      record(value, at);
    }
  }
  return earliest;
}
