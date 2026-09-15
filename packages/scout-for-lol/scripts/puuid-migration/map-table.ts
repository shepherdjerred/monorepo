/**
 * The migration's own tables, and bringing an older one up to date.
 *
 * Kept out of the phases because this is schema management, not a phase: every
 * run calls it before doing anything, including runs against a database whose
 * map was written by a version of this script that had fewer columns.
 */

import type { Db } from "./db.ts";

export async function ensureMapTable(db: Db): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS "PuuidKeyMap" (
      "oldPuuid"    TEXT PRIMARY KEY,
      "gameName"    TEXT,
      "tagLine"     TEXT,
      "newPuuid"    TEXT,
      "status"      TEXT NOT NULL DEFAULT 'pending',
      "harvestedAt" ${db.timestampType()},
      "resolvedAt"  ${db.timestampType()},
      "appliedAt"   ${db.timestampType()}
    )
  `);
  // A source domain can be reused after a return cycle. Keep each applied edge
  // when a later transition needs to reuse that same oldPuuid; the live map row
  // then remains available for the current transition's unresolved delta.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS "PuuidKeyMapHistory" (
      "oldPuuid"  TEXT NOT NULL,
      "newPuuid"  TEXT NOT NULL,
      "appliedAt" ${db.timestampType()} NOT NULL,
      PRIMARY KEY ("oldPuuid", "appliedAt")
    )
  `);
  await db.exec(
    `CREATE INDEX IF NOT EXISTS "PuuidKeyMapHistory_oldPuuid_idx" ON "PuuidKeyMapHistory" ("oldPuuid")`,
  );
  await db.exec(
    `CREATE INDEX IF NOT EXISTS "PuuidKeyMap_status_idx" ON "PuuidKeyMap" ("status")`,
  );
  // A separate single-row table, not a column on the map. CREATE TABLE IF NOT
  // EXISTS is idempotent on both dialects, where ADD COLUMN is not — SQLite has
  // no IF NOT EXISTS for it, so a column added to an existing table has to be
  // guarded by reading the catalog.
  //
  // Created before the backfill below, which reads it.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS "PuuidKeyMigration" (
      "id"        INTEGER PRIMARY KEY,
      "appliedAt" ${db.timestampType()},
      "transitionOpen" INTEGER NOT NULL DEFAULT 1
    )
  `);
  await addAppliedAtToExistingMap(db);
  await addTransitionOpenToMigration(db);
}

/** Track whether applied replacements may be collected as the next domain. */
async function addTransitionOpenToMigration(db: Db): Promise<void> {
  const columns = await db.listColumns("PuuidKeyMigration");
  if (columns.includes("transitionOpen")) {
    return;
  }
  await db.exec(
    `ALTER TABLE "PuuidKeyMigration" ADD COLUMN "transitionOpen" INTEGER NOT NULL DEFAULT 1`,
  );
  // A null cutover marker with already-applied map rows is an interrupted
  // marker write, not an explicitly opened later transition.
  await db.exec(`
    UPDATE "PuuidKeyMigration"
       SET "transitionOpen" = CASE
         WHEN "appliedAt" IS NOT NULL THEN 0
         WHEN EXISTS (
           SELECT 1 FROM "PuuidKeyMap" WHERE "appliedAt" IS NOT NULL
         ) THEN 0
         ELSE 1
       END
  `);
}

/**
 * Bring a map table created before `appliedAt` existed up to date.
 *
 * The column records when a mapping's stored references were rewritten, which
 * is what makes it usable. Any row that already has a replacement in a database
 * whose cutover is recorded was rewritten by that cutover, so it inherits the
 * cutover's own timestamp rather than being treated as never applied.
 */
async function addAppliedAtToExistingMap(db: Db): Promise<void> {
  const columns = await db.listColumns("PuuidKeyMap");
  if (columns.includes("appliedAt")) {
    return;
  }
  await db.exec(
    `ALTER TABLE "PuuidKeyMap" ADD COLUMN "appliedAt" ${db.timestampType()}`,
  );
  await db.exec(`
    UPDATE "PuuidKeyMap"
       SET "appliedAt" = (
             SELECT "appliedAt" FROM "PuuidKeyMigration"
              WHERE "id" = 1 AND "appliedAt" IS NOT NULL
           )
     WHERE "newPuuid" IS NOT NULL
       AND EXISTS (
             SELECT 1 FROM "PuuidKeyMigration"
              WHERE "id" = 1 AND "appliedAt" IS NOT NULL
           )
  `);
  console.log("  added PuuidKeyMap.appliedAt and backfilled from the cutover");
}
