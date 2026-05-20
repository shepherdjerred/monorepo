-- CreateTable
CREATE TABLE "StoredMatch" (
    "matchId" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "queueId" INTEGER NOT NULL,
    "queue" TEXT,
    "gameMode" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "gameVersion" TEXT NOT NULL,
    "gameCreationAt" DATETIME NOT NULL,
    "gameStartAt" DATETIME,
    "gameEndAt" DATETIME NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "participantPuuidsJson" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "s3Key" TEXT,
    "importedFromS3" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StoredMatchTimeline" (
    "matchId" TEXT NOT NULL PRIMARY KEY,
    "rawJson" TEXT NOT NULL,
    "s3Key" TEXT,
    "importedFromS3" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StoredPrematch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dedupeKey" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "gameStartAt" DATETIME,
    "observedAt" DATETIME NOT NULL,
    "platformId" TEXT NOT NULL,
    "queueId" INTEGER NOT NULL,
    "queue" TEXT,
    "gameMode" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "participantPuuidsJson" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "s3Key" TEXT,
    "importedFromS3" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MatchParticipantFact" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "gameCreationAt" DATETIME NOT NULL,
    "gameEndAt" DATETIME NOT NULL,
    "queueId" INTEGER NOT NULL,
    "queue" TEXT,
    "durationSeconds" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "accountId" INTEGER,
    "playerAlias" TEXT NOT NULL,
    "discordId" TEXT,
    "puuid" TEXT NOT NULL,
    "region" TEXT,
    "participantId" INTEGER NOT NULL,
    "teamId" INTEGER NOT NULL,
    "championId" INTEGER NOT NULL,
    "championName" TEXT NOT NULL,
    "win" BOOLEAN NOT NULL,
    "surrendered" BOOLEAN NOT NULL,
    "earlySurrendered" BOOLEAN NOT NULL,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "kda" REAL NOT NULL,
    "creepScore" INTEGER NOT NULL,
    "goldEarned" INTEGER NOT NULL,
    "totalDamageDealt" INTEGER NOT NULL,
    "damageToChampions" INTEGER NOT NULL,
    "damageTaken" INTEGER NOT NULL,
    "visionScore" INTEGER NOT NULL,
    "rawParticipantJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PrematchParticipantFact" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storedPrematchId" INTEGER NOT NULL,
    "serverId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "gameStartAt" DATETIME,
    "queueId" INTEGER NOT NULL,
    "queue" TEXT,
    "gameMode" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "accountId" INTEGER,
    "playerAlias" TEXT NOT NULL,
    "discordId" TEXT,
    "puuid" TEXT NOT NULL,
    "region" TEXT,
    "teamId" INTEGER NOT NULL,
    "playerSubteamId" INTEGER,
    "championId" INTEGER NOT NULL,
    "riotId" TEXT NOT NULL,
    "summonerName" TEXT,
    "selectedSkinIndex" INTEGER NOT NULL,
    "rawParticipantJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReportStoreImportProgress" (
    "source" TEXT NOT NULL PRIMARY KEY,
    "importStatus" TEXT NOT NULL,
    "lastKey" TEXT,
    "scannedObjects" INTEGER NOT NULL DEFAULT 0,
    "importedObjects" INTEGER NOT NULL DEFAULT 0,
    "skippedObjects" INTEGER NOT NULL DEFAULT 0,
    "failedObjects" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReportStoreImportFailure" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "payloadType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "StoredMatch_gameCreationAt_idx" ON "StoredMatch"("gameCreationAt");
CREATE INDEX "StoredMatch_queueId_gameCreationAt_idx" ON "StoredMatch"("queueId", "gameCreationAt");
CREATE INDEX "StoredMatch_s3Key_idx" ON "StoredMatch"("s3Key");

-- CreateIndex
CREATE INDEX "StoredMatchTimeline_s3Key_idx" ON "StoredMatchTimeline"("s3Key");

-- CreateIndex
CREATE UNIQUE INDEX "StoredPrematch_dedupeKey_key" ON "StoredPrematch"("dedupeKey");
CREATE INDEX "StoredPrematch_observedAt_idx" ON "StoredPrematch"("observedAt");
CREATE INDEX "StoredPrematch_queueId_observedAt_idx" ON "StoredPrematch"("queueId", "observedAt");
CREATE INDEX "StoredPrematch_s3Key_idx" ON "StoredPrematch"("s3Key");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipantFact_serverId_matchId_puuid_key" ON "MatchParticipantFact"("serverId", "matchId", "puuid");
CREATE INDEX "MatchParticipantFact_serverId_gameCreationAt_idx" ON "MatchParticipantFact"("serverId", "gameCreationAt");
CREATE INDEX "MatchParticipantFact_serverId_queueId_gameCreationAt_idx" ON "MatchParticipantFact"("serverId", "queueId", "gameCreationAt");
CREATE INDEX "MatchParticipantFact_serverId_playerId_gameCreationAt_idx" ON "MatchParticipantFact"("serverId", "playerId", "gameCreationAt");
CREATE INDEX "MatchParticipantFact_matchId_idx" ON "MatchParticipantFact"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "PrematchParticipantFact_storedPrematchId_serverId_puuid_key" ON "PrematchParticipantFact"("storedPrematchId", "serverId", "puuid");
CREATE INDEX "PrematchParticipantFact_serverId_observedAt_idx" ON "PrematchParticipantFact"("serverId", "observedAt");
CREATE INDEX "PrematchParticipantFact_serverId_queueId_observedAt_idx" ON "PrematchParticipantFact"("serverId", "queueId", "observedAt");
CREATE INDEX "PrematchParticipantFact_serverId_playerId_observedAt_idx" ON "PrematchParticipantFact"("serverId", "playerId", "observedAt");
CREATE INDEX "PrematchParticipantFact_gameId_idx" ON "PrematchParticipantFact"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportStoreImportFailure_source_s3Key_payloadType_key" ON "ReportStoreImportFailure"("source", "s3Key", "payloadType");
CREATE INDEX "ReportStoreImportFailure_source_createdAt_idx" ON "ReportStoreImportFailure"("source", "createdAt");
