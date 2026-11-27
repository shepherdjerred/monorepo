-- Erasure counts and finds a player's matches by "visitedPuuid", and crawled
-- matches are kept forever, so that scan grows every day. CONCURRENTLY builds
-- the index without blocking the crawl's writes, so this file holds exactly one
-- statement: CONCURRENTLY cannot run inside the transaction Prisma opens around
-- a multi-statement migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CrawlMatch_visitedPuuid_idx" ON "CrawlMatch"("visitedPuuid");
