-- CreateTable
CREATE TABLE "MatchRankHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "matchId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "queueType" TEXT NOT NULL,
    "rankBefore" TEXT,
    "rankAfter" TEXT,
    "capturedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "MatchRankHistory_puuid_capturedAt_idx" ON "MatchRankHistory"("puuid", "capturedAt");

-- CreateIndex
CREATE INDEX "MatchRankHistory_matchId_idx" ON "MatchRankHistory"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchRankHistory_matchId_puuid_queueType_key" ON "MatchRankHistory"("matchId", "puuid", "queueType");
