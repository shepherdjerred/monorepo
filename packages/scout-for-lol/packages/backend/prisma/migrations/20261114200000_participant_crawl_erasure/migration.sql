-- AlterTable
ALTER TABLE "ErasedPuuid" ADD COLUMN "rawCursorCreatedAt" TIMESTAMP(3),
ADD COLUMN "rawCursorSha256" TEXT,
ADD COLUMN "rawSweptAt" TIMESTAMP(3),
ADD COLUMN "lakeErasedAt" TIMESTAMP(3),
ADD COLUMN "segmentsRewritten" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "matchesRemoved" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "copiesRedacted" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CrawlObjectDeletion" (
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlObjectDeletion_pkey" PRIMARY KEY ("objectKey")
);

-- CreateIndex
CREATE INDEX "ErasedPuuid_lakeErasedAt_idx" ON "ErasedPuuid"("lakeErasedAt");

-- CreateIndex
CREATE INDEX "ErasedPuuid_rawSweptAt_idx" ON "ErasedPuuid"("rawSweptAt");

-- CreateIndex
CREATE INDEX "CrawlSegment_createdAt_sha256_idx" ON "CrawlSegment"("createdAt", "sha256");

-- The sweep cursor is both fields or neither.
ALTER TABLE "ErasedPuuid" ADD CONSTRAINT "ErasedPuuid_raw_cursor_check"
  CHECK (("rawCursorCreatedAt" IS NULL) = ("rawCursorSha256" IS NULL));

-- Only crawl objects are ever queued for deletion.
ALTER TABLE "CrawlObjectDeletion" ADD CONSTRAINT "CrawlObjectDeletion_prefix_check"
  CHECK ("objectKey" LIKE 'crawl/v1/%');
