-- Contract step of retiring four CrawlFrontier columns nothing reads. It runs
-- only once no running pod writes them: the previous release inserted
-- "seedMatchId", "visitCount", "createdAt" and "updatedAt", and a pod on it
-- would fail against this migration.
-- Every statement is catalog-only: dropping a column rewrites no row (the space
-- comes back as the pruner deletes old rows and new rows are written without
-- it), and the old (nextEligibleAt, depth) index is replaced by
-- "CrawlFrontier_depth_nextEligibleAt_idx", which the claim's
-- `ORDER BY depth, nextEligibleAt` reads in order.
-- The migration runs in one transaction, so the lock timeout bounds how long it
-- can queue behind a running crawl query; on a timeout it fails and the image
-- start retries it, rather than stalling the crawl's writes behind it.
SET LOCAL lock_timeout = '10s';

DROP INDEX IF EXISTS "CrawlFrontier_nextEligibleAt_depth_idx";

ALTER TABLE "CrawlFrontier"
  DROP COLUMN "seedMatchId",
  DROP COLUMN "visitCount",
  DROP COLUMN "createdAt",
  DROP COLUMN "updatedAt";
