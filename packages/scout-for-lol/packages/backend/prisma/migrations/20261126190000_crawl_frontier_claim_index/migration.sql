-- The claim and the pruner both walk the frontier in (depth, nextEligibleAt)
-- order. CONCURRENTLY builds it without blocking the crawl's writes, so this
-- file holds exactly one statement: CONCURRENTLY cannot run inside the
-- transaction Prisma opens around a multi-statement migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CrawlFrontier_depth_nextEligibleAt_idx" ON "CrawlFrontier"("depth", "nextEligibleAt");
