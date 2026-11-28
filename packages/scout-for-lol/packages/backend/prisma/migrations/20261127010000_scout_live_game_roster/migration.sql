-- The Live game page's roster: ten players per game, written at prematch
-- detection and read from PostgreSQL alone. Rows are transient; see
-- `live-roster-retention.ts` for the window.

-- CreateTable
CREATE TABLE "LiveGameRoster" (
    "riotMatchId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "queueId" INTEGER NOT NULL,
    "gameMode" TEXT NOT NULL,
    "gameStartedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "participants" JSONB NOT NULL,
    "trackedPuuids" TEXT[],
    "recentForm" JSONB NOT NULL DEFAULT '{}',
    "recentFormCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveGameRoster_pkey" PRIMARY KEY ("riotMatchId")
);

-- CreateIndex
CREATE INDEX "LiveGameRoster_detectedAt_idx" ON "LiveGameRoster"("detectedAt");

-- CreateIndex
CREATE INDEX "LiveGameRoster_expiresAt_idx" ON "LiveGameRoster"("expiresAt");
