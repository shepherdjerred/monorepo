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
import {
  asOptionalString,
  asString,
  countOf,
  toEpochMillis,
} from "./support.ts";

export /**
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
async function knownIdentities(db: Db): Promise<Set<string>> {
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

export /** Whether `apply` has finished rewriting this database to the new domain. */
async function cutoverApplied(db: Db): Promise<boolean> {
  const rows = await db.query(
    `SELECT COUNT(*) AS n FROM "PuuidKeyMigration" WHERE "appliedAt" IS NOT NULL`,
  );
  return countOf(rows, "cutover marker") > 0;
}

export /**
 * Tracked identities that should have been migrated and were not.
 *
 * Before the cutover, any unmapped tracked identity is missed work. After it,
 * most are not: an account registered since is already new-domain and is
 * deliberately absent from the map, which is why `collect` refuses to record
 * one. Only an account that predates the cutover and is still unmapped was
 * actually skipped — so the marker's timestamp, not its mere presence, is what
 * separates the two. Without that distinction a re-run of the advertised
 * resumable `verify` would fail permanently on healthy accounts.
 */
async function strayIdentities(db: Db): Promise<string[]> {
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

  // Compared here rather than in SQL: `createdTime` is epoch-millisecond
  // integers in the promoted SQLite image and a timestamp elsewhere, and SQLite
  // sorts every integer before every text value, so the SQL form was true for
  // every account regardless of date.
  const accountRows = await db.query(
    `SELECT "puuid" AS p, "createdTime" AS t FROM "Account"`,
  );
  const createdAt = new Map<string, number>();
  for (const row of accountRows) {
    const value = row["t"];
    if (value === null || value === undefined) {
      continue;
    }
    createdAt.set(
      asString(row["p"], "account puuid"),
      toEpochMillis(value, "account createdTime"),
    );
  }

  return unmapped.filter((puuid) => {
    const created = createdAt.get(puuid);
    // An identity with no account row cannot be dated, so it stays a stray
    // rather than being excused by a missing timestamp.
    return created === undefined || created < appliedAt;
  });
}
