-- CreateTable
CREATE TABLE "Competition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT NOT NULL,
    "criteriaType" TEXT NOT NULL,
    "criteriaConfig" TEXT NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 50,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "seasonId" TEXT,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CompetitionParticipant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "competitionId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "invitedBy" TEXT,
    "joinedAt" DATETIME NOT NULL,
    "leftAt" DATETIME,
    CONSTRAINT "CompetitionParticipant_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompetitionParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompetitionSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "competitionId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "snapshotType" TEXT NOT NULL,
    "snapshotData" TEXT NOT NULL,
    "snapshotTime" DATETIME NOT NULL,
    CONSTRAINT "CompetitionSnapshot_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CompetitionSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServerPermission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Competition_serverId_isCancelled_idx" ON "Competition"("serverId", "isCancelled");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_serverId_ownerId_key" ON "Competition"("serverId", "ownerId");

-- CreateIndex
CREATE INDEX "CompetitionParticipant_competitionId_status_idx" ON "CompetitionParticipant"("competitionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionParticipant_competitionId_playerId_key" ON "CompetitionParticipant"("competitionId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionSnapshot_competitionId_playerId_snapshotType_key" ON "CompetitionSnapshot"("competitionId", "playerId", "snapshotType");

-- CreateIndex
CREATE UNIQUE INDEX "ServerPermission_serverId_discordUserId_permission_key" ON "ServerPermission"("serverId", "discordUserId", "permission");
