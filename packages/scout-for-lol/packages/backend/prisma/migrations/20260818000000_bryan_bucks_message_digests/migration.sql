-- Preserve the non-betting portion of each pool's prematch Discord message so
-- later position changes can edit that message in place without fetching it.
-- Existing in-flight pools remain NULL and are intentionally not edited.
ALTER TABLE "BucksMatchPool" ADD COLUMN "prematchContentBase" TEXT;
