-- Preserve a per-(match, guild) retry record when a welcome grant cannot be
-- funded. Existing rows are completed awards and remain idempotency markers.
-- SQLite cannot add a CURRENT_TIMESTAMP default to a populated table. Rebuild
-- the small marker table so existing rows receive explicit completed values and
-- new rows retain the schema defaults.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_BucksMatchEarning" (
    "matchId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'complete',
    "targetSnapshotJson" TEXT NOT NULL DEFAULT '[]',
    "retryAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchCreatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryCount" INTEGER NOT NULL,

    PRIMARY KEY ("matchId", "serverId")
);

INSERT INTO "new_BucksMatchEarning" (
    "matchId",
    "serverId",
    "awardedAt",
    "state",
    "targetSnapshotJson",
    "retryAt",
    "matchCreatedAt",
    "entryCount"
)
SELECT
    "matchId",
    "serverId",
    "awardedAt",
    'complete',
    '[]',
    "awardedAt",
    "awardedAt",
    "entryCount"
FROM "BucksMatchEarning";

DROP TABLE "BucksMatchEarning";
ALTER TABLE "new_BucksMatchEarning" RENAME TO "BucksMatchEarning";

CREATE INDEX "BucksMatchEarning_state_retryAt_idx"
ON "BucksMatchEarning"("state", "retryAt");

PRAGMA foreign_keys=ON;
