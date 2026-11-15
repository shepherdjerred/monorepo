-- CreateTable
CREATE TABLE "CrawlFrontier" (
    "puuid" TEXT NOT NULL,
    "platformRoute" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "seedMatchId" TEXT NOT NULL,
    "rankTier" TEXT,
    "rankDivision" TEXT,
    "rankedAt" TIMESTAMP(3),
    "lastVisitedAt" TIMESTAMP(3),
    "nextEligibleAt" TIMESTAMP(3) NOT NULL,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlFrontier_pkey" PRIMARY KEY ("puuid")
);

-- CreateTable
CREATE TABLE "CrawlMatch" (
    "riotMatchId" TEXT NOT NULL,
    "platformRoute" TEXT NOT NULL,
    "queueId" INTEGER NOT NULL,
    "gameCreatedAt" TIMESTAMP(3) NOT NULL,
    "depth" INTEGER NOT NULL,
    "visitedPuuid" TEXT NOT NULL,
    "timelineSampled" BOOLEAN NOT NULL,
    "segmentSha256" TEXT NOT NULL,
    "crawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlMatch_pkey" PRIMARY KEY ("riotMatchId")
);

-- CreateTable
CREATE TABLE "CrawlSegment" (
    "sha256" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "dt" TEXT NOT NULL,
    "matchCount" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlSegment_pkey" PRIMARY KEY ("sha256")
);

-- CreateTable
CREATE TABLE "CrawlControl" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "seedCursorObservedAt" TIMESTAMP(3) NOT NULL,
    "seedCursorMatchId" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErasedPuuid" (
    "puuidHash" TEXT NOT NULL,
    "erasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErasedPuuid_pkey" PRIMARY KEY ("puuidHash")
);

-- CreateIndex
CREATE INDEX "CrawlFrontier_nextEligibleAt_depth_idx" ON "CrawlFrontier"("nextEligibleAt", "depth");

-- CreateIndex
CREATE INDEX "CrawlMatch_crawledAt_idx" ON "CrawlMatch"("crawledAt");

-- CreateIndex
CREATE INDEX "CrawlMatch_segmentSha256_idx" ON "CrawlMatch"("segmentSha256");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlSegment_objectKey_key" ON "CrawlSegment"("objectKey");

-- CreateIndex
CREATE INDEX "CrawlSegment_dt_route_idx" ON "CrawlSegment"("dt", "route");

-- AddForeignKey
ALTER TABLE "CrawlMatch" ADD CONSTRAINT "CrawlMatch_segmentSha256_fkey" FOREIGN KEY ("segmentSha256") REFERENCES "CrawlSegment"("sha256") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The crawl reaches at most two hops from a tracked participant.
ALTER TABLE "CrawlFrontier" ADD CONSTRAINT "CrawlFrontier_depth_check"
  CHECK ("depth" BETWEEN 0 AND 2);
ALTER TABLE "CrawlMatch" ADD CONSTRAINT "CrawlMatch_depth_check"
  CHECK ("depth" BETWEEN 0 AND 2);

-- A visited player is not eligible again for seven days.
ALTER TABLE "CrawlFrontier" ADD CONSTRAINT "CrawlFrontier_cooldown_check"
  CHECK ("lastVisitedAt" IS NULL OR "nextEligibleAt" >= "lastVisitedAt" + INTERVAL '7 days');

-- A bracket is both fields or neither.
ALTER TABLE "CrawlFrontier" ADD CONSTRAINT "CrawlFrontier_rank_check"
  CHECK (("rankTier" IS NULL) = ("rankDivision" IS NULL));

-- Exactly one control row.
ALTER TABLE "CrawlControl" ADD CONSTRAINT "CrawlControl_singleton_check"
  CHECK ("id" = 'default');

-- Erased players are stored only as a SHA-256 hex digest.
ALTER TABLE "ErasedPuuid" ADD CONSTRAINT "ErasedPuuid_hash_check"
  CHECK ("puuidHash" ~ '^[0-9a-f]{64}$');
