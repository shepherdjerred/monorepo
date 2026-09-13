-- A mapping becomes usable when its stored references have been rewritten, not
-- when it was resolved. Without this, re-resolving an identity that a previous
-- cutover deliberately left unresolved would expose the new identifier to the
-- report lake while the database still held the old one.
ALTER TABLE "PuuidKeyMap" ADD COLUMN "appliedAt" TIMESTAMPTZ;

-- Every mapping that already has a replacement in a database whose cutover is
-- recorded was rewritten by that cutover, so it carries the cutover's own time.
UPDATE "PuuidKeyMap"
   SET "appliedAt" = (
         SELECT "appliedAt" FROM "PuuidKeyMigration"
          WHERE "id" = 1 AND "appliedAt" IS NOT NULL
       )
 WHERE "newPuuid" IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM "PuuidKeyMigration"
          WHERE "id" = 1 AND "appliedAt" IS NOT NULL
       );
