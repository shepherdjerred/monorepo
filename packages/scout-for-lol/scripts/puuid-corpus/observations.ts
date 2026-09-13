/**
 * Keeping `MatchObservation`'s artifact references true after a rewrite.
 *
 * The observation pairs an object key with the SHA-256 of its canonical bytes,
 * and the schema is explicit that a different digest arriving later is a
 * conflict — two producers disagreeing — rather than an update. Re-domaining an
 * object changes those bytes, so unless the pair moves with it the database
 * asserts a digest nothing under that key will ever match again.
 */

import type { Db } from "#scripts/puuid-migration/db.ts";
import { countOf } from "#scripts/puuid-migration/support.ts";

/** Point the stored artifact reference at the bytes now under that key. */
export async function recordRewrittenDigest(
  db: Db,
  key: string,
  digest: string,
): Promise<number> {
  let updated = 0;
  for (const column of ["matchObjectKey", "timelineObjectKey"] as const) {
    const digestColumn =
      column === "matchObjectKey" ? "matchDigest" : "timelineDigest";
    await db.exec(
      `UPDATE "MatchObservation" SET "${digestColumn}" = ${db.param(2)}
        WHERE "${column}" = ${db.param(1)} AND "${digestColumn}" <> ${db.param(2)}`,
      [key, digest],
    );
    const rows = await db.query(
      `SELECT COUNT(*) AS n FROM "MatchObservation"
        WHERE "${column}" = ${db.param(1)} AND "${digestColumn}" = ${db.param(2)}`,
      [key, digest],
    );
    updated += countOf(rows, "observation digest");
  }
  return updated;
}

/** Whether this database even models observations; prod's older one does not. */
export async function hasObservations(db: Db): Promise<boolean> {
  const tables = await db.listTables();
  return tables.includes("MatchObservation");
}
