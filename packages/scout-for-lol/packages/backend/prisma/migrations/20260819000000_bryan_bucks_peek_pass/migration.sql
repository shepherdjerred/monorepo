-- Add the per-guild peek entitlement and the pool's frozen reveal time.
ALTER TABLE "BucksAccount" ADD COLUMN "peekPassExpiresAt" DATETIME;

-- SQLite permits only constant defaults when ALTER TABLE adds a column. New
-- pools always provide this field explicitly; zero exists only long enough for
-- the next statement to backfill historical rows.
ALTER TABLE "BucksMatchPool" ADD COLUMN "peekAvailableAt" DATETIME NOT NULL DEFAULT 0;

-- Historical terminal pools use the requested detected-at backfill. A pool
-- that survives this deployment may have been detected during Spectator's
-- negative game-length countdown, whose duration was not retained. Keep those
-- unresolved pools private until their existing betting window has closed so
-- the migration can never reveal an estimate before two minutes of play.
UPDATE "BucksMatchPool"
SET "peekAvailableAt" = CASE
  WHEN "poolState" IN ('open', 'closed')
    THEN MAX("closesAt", "detectedAt" + 120000)
  ELSE "detectedAt" + 120000
END;

CREATE INDEX "BucksMatchPool_serverId_poolState_peekAvailableAt_idx"
ON "BucksMatchPool"("serverId", "poolState", "peekAvailableAt");

CREATE INDEX "BucksMatchPool_serverId_poolState_settledAt_idx"
ON "BucksMatchPool"("serverId", "poolState", "settledAt");
