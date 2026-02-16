/*
  Warnings:

  - Added the required column `playerId` to the `Account` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Competition_serverId_ownerId_key";

-- CreateTable
CREATE TABLE "GuildPermissionError" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "errorReason" TEXT,
    "firstOccurrence" DATETIME NOT NULL,
    "lastOccurrence" DATETIME NOT NULL,
    "consecutiveErrorCount" INTEGER NOT NULL DEFAULT 1,
    "lastSuccessfulSend" DATETIME,
    "ownerNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "lastSeenInGame" DATETIME,
    "serverId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL,
    CONSTRAINT "Account_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("alias", "createdTime", "creatorDiscordId", "id", "puuid", "region", "serverId", "updatedTime") SELECT "alias", "createdTime", "creatorDiscordId", "id", "puuid", "region", "serverId", "updatedTime" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_serverId_puuid_key" ON "Account"("serverId", "puuid");
CREATE TABLE "new_CompetitionParticipant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "competitionId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "invitedBy" TEXT,
    "invitedAt" DATETIME,
    "joinedAt" DATETIME,
    "leftAt" DATETIME,
    CONSTRAINT "CompetitionParticipant_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompetitionParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CompetitionParticipant" ("competitionId", "id", "invitedBy", "joinedAt", "leftAt", "playerId", "status") SELECT "competitionId", "id", "invitedBy", "joinedAt", "leftAt", "playerId", "status" FROM "CompetitionParticipant";
DROP TABLE "CompetitionParticipant";
ALTER TABLE "new_CompetitionParticipant" RENAME TO "CompetitionParticipant";
CREATE INDEX "CompetitionParticipant_competitionId_status_idx" ON "CompetitionParticipant"("competitionId", "status");
CREATE UNIQUE INDEX "CompetitionParticipant_competitionId_playerId_key" ON "CompetitionParticipant"("competitionId", "playerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "GuildPermissionError_serverId_consecutiveErrorCount_idx" ON "GuildPermissionError"("serverId", "consecutiveErrorCount");

-- CreateIndex
CREATE INDEX "GuildPermissionError_lastOccurrence_idx" ON "GuildPermissionError"("lastOccurrence");

-- CreateIndex
CREATE UNIQUE INDEX "GuildPermissionError_serverId_channelId_key" ON "GuildPermissionError"("serverId", "channelId");

-- CreateIndex
CREATE INDEX "Competition_serverId_ownerId_isCancelled_idx" ON "Competition"("serverId", "ownerId", "isCancelled");
