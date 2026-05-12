-- Lifecycle retry tracking. Existing processed rows are treated as already
-- notified so deploys do not duplicate historical Discord messages in beta/prod.
ALTER TABLE "Competition" ADD COLUMN "startNotifiedAt" DATETIME;
ALTER TABLE "Competition" ADD COLUMN "endNotifiedAt" DATETIME;
ALTER TABLE "Competition" ADD COLUMN "startNotificationMessageId" TEXT;
ALTER TABLE "Competition" ADD COLUMN "endNotificationMessageId" TEXT;

UPDATE "Competition"
SET "startNotifiedAt" = "startProcessedAt"
WHERE "startProcessedAt" IS NOT NULL
  AND "startNotifiedAt" IS NULL;

UPDATE "Competition"
SET "endNotifiedAt" = "endProcessedAt"
WHERE "endProcessedAt" IS NOT NULL
  AND "endNotifiedAt" IS NULL;

-- Match-time rank history metadata. Old rows keep null match-time columns and
-- readers fall back to capturedAt for legacy data.
ALTER TABLE "MatchRankHistory" ADD COLUMN "matchGameCreationAt" DATETIME;
ALTER TABLE "MatchRankHistory" ADD COLUMN "matchGameEndAt" DATETIME;

CREATE INDEX "MatchRankHistory_puuid_queueType_matchGameEndAt_idx"
  ON "MatchRankHistory"("puuid", "queueType", "matchGameEndAt");
