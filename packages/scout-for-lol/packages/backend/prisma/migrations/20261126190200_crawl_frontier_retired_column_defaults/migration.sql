-- Expand step of retiring four CrawlFrontier columns nothing reads. The code
-- from this release no longer writes "seedMatchId" or "updatedAt" (the two with
-- no default), so a row must insert without them. Setting a default is
-- catalog-only: no row is rewritten and the lock is brief. Pods still running
-- the previous release keep writing all four columns, which still exist; a
-- later migration drops them once this release is deployed everywhere.
-- The migration runs in one transaction, so the lock timeout bounds how long it
-- can queue behind a running crawl query.
SET LOCAL lock_timeout = '10s';

ALTER TABLE "CrawlFrontier"
  ALTER COLUMN "seedMatchId" SET DEFAULT '',
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
