-- Keep Bryan Bucks member retention on an app-owned UUID rather than a Discord
-- snowflake. Existing accounts receive a stable identity during migration;
-- Prisma generates the value for newly-created accounts.
ALTER TABLE "BucksAccount" ADD COLUMN "analyticsUserId" TEXT;

UPDATE "BucksAccount"
SET "analyticsUserId" = gen_random_uuid()::text
WHERE "analyticsUserId" IS NULL;

ALTER TABLE "BucksAccount"
  ALTER COLUMN "analyticsUserId" SET NOT NULL;

CREATE UNIQUE INDEX "BucksAccount_analyticsUserId_key"
  ON "BucksAccount"("analyticsUserId");
