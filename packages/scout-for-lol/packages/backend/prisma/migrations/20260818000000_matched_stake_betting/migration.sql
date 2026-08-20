-- Bryan Bucks close-time matching.
--
-- `BucksBet.stake` remains the submitted maximum for backwards compatibility.
-- The nullable allocation columns distinguish historical rows from positions
-- processed by matching version 1. An explicit active-position table replaces
-- the old unique bet index so cancelled attempts remain auditable.

ALTER TABLE "BucksBet" ADD COLUMN "humanMatchedStake" INTEGER;
ALTER TABLE "BucksBet" ADD COLUMN "houseMatchedStake" INTEGER;
ALTER TABLE "BucksBet" ADD COLUMN "matchedStake" INTEGER;
ALTER TABLE "BucksBet" ADD COLUMN "unmatchedStake" INTEGER;
ALTER TABLE "BucksBet" ADD COLUMN "grossPayout" INTEGER;
ALTER TABLE "BucksBet" ADD COLUMN "fee" INTEGER;
ALTER TABLE "BucksBet" ADD COLUMN "cancelledAt" DATETIME;

ALTER TABLE "BucksMatchPool" ADD COLUMN "matchedAt" DATETIME;
ALTER TABLE "BucksMatchPool" ADD COLUMN "matchingJson" TEXT;

CREATE TABLE "BucksOpenPosition" (
    "poolId" INTEGER NOT NULL,
    "bucksAccountId" INTEGER NOT NULL,
    "betId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("poolId", "bucksAccountId"),
    CONSTRAINT "BucksOpenPosition_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "BucksMatchPool" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BucksOpenPosition_bucksAccountId_fkey" FOREIGN KEY ("bucksAccountId") REFERENCES "BucksAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BucksOpenPosition_betId_fkey" FOREIGN KEY ("betId") REFERENCES "BucksBet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Existing open positions become editable slots. Closed legacy pools are
-- deliberately omitted: they can no longer be changed, and the first close or
-- settlement pass will allocate them under matching version 1.
INSERT INTO "BucksOpenPosition" ("poolId", "bucksAccountId", "betId", "createdAt")
SELECT bet."poolId", bet."bucksAccountId", bet."id", bet."createdAt"
FROM "BucksBet" AS bet
JOIN "BucksMatchPool" AS pool ON pool."id" = bet."poolId"
WHERE bet."betOutcome" = 'pending'
  AND pool."poolState" = 'open';

DROP INDEX "BucksBet_poolId_bucksAccountId_key";
CREATE INDEX "BucksBet_poolId_bucksAccountId_idx" ON "BucksBet"("poolId", "bucksAccountId");
CREATE UNIQUE INDEX "BucksOpenPosition_betId_key" ON "BucksOpenPosition"("betId");
CREATE INDEX "BucksOpenPosition_poolId_idx" ON "BucksOpenPosition"("poolId");
