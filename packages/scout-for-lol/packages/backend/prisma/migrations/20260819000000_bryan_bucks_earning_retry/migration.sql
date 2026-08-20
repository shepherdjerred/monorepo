-- Preserve a per-(match, guild) retry record when a welcome grant cannot be
-- funded. Existing rows are completed awards and remain idempotency markers.
ALTER TABLE "BucksMatchEarning"
ADD COLUMN "state" TEXT NOT NULL DEFAULT 'complete';

ALTER TABLE "BucksMatchEarning"
ADD COLUMN "targetSnapshotJson" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "BucksMatchEarning"
ADD COLUMN "retryAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
