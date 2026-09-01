ALTER TABLE "BucksDareV2"
ADD COLUMN "calloutRefreshPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "calloutRefreshVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "BucksDareV2_calloutRefreshPending_updatedAt_idx"
ON "BucksDareV2"("calloutRefreshPending", "updatedAt");
