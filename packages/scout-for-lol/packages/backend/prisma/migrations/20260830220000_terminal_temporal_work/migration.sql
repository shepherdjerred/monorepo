ALTER TABLE "ScoutTemporalWork"
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "requeueCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastRequeueReason" TEXT,
ADD COLUMN "failedAt" TIMESTAMP(3),
ADD COLUMN "lastRequeuedAt" TIMESTAMP(3);

UPDATE "ScoutTemporalWork"
SET
  "state" = 'failed',
  "failedAt" = "updatedAt"
WHERE
  "state" = 'queued'
  AND "startedAt" IS NOT NULL
  AND "lastError" IS NOT NULL;
