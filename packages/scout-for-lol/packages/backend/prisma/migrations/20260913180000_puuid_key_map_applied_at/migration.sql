-- A mapping becomes usable when its stored references have been rewritten, not
-- when it was resolved. Without this, re-resolving an identity that a previous
-- cutover deliberately left unresolved would expose the new identifier to the
-- report lake while the database still held the old one.
-- IF NOT EXISTS because the migration script may have added the column first.
-- The map table itself is adopted the same way: an environment can be migrated
-- by the script before the backend that manages the schema is deployed to it.
ALTER TABLE "PuuidKeyMap" ADD COLUMN IF NOT EXISTS "appliedAt" TIMESTAMPTZ;

-- Every mapping that already has a replacement in a database whose cutover is
-- recorded was rewritten by that cutover, so it carries the cutover's own time.
UPDATE "PuuidKeyMap"
   SET "appliedAt" = (
         SELECT "appliedAt" FROM "PuuidKeyMigration"
          WHERE "id" = 1 AND "appliedAt" IS NOT NULL
       )
 WHERE "newPuuid" IS NOT NULL
   AND "appliedAt" IS NULL
   AND EXISTS (
         SELECT 1 FROM "PuuidKeyMigration"
          WHERE "id" = 1 AND "appliedAt" IS NOT NULL
       )
   -- ...but only if nothing has stamped this table yet. Where the script got
   -- here first, its per-mapping answer is the accurate one: a row it left
   -- unstamped is a recovery whose rewrite has not run, and backfilling that
   -- from the cutover would publish a mapping the stored columns do not hold.
   AND NOT EXISTS (
         SELECT 1 FROM "PuuidKeyMap" WHERE "appliedAt" IS NOT NULL
       );
