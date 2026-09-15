-- Preserve the explicit later-transition boundary across SQLite promotion.
-- A null cutover marker alone cannot distinguish begin --new-transition from
-- an interrupted apply that already stamped mapping rows.
ALTER TABLE "PuuidKeyMigration"
  ADD COLUMN IF NOT EXISTS "transitionOpen" INTEGER NOT NULL DEFAULT 1;

UPDATE "PuuidKeyMigration"
   SET "transitionOpen" = CASE
     WHEN "appliedAt" IS NOT NULL THEN 0
     WHEN EXISTS (
       SELECT 1 FROM "PuuidKeyMap" WHERE "appliedAt" IS NOT NULL
     ) THEN 0
     ELSE 1
   END;
