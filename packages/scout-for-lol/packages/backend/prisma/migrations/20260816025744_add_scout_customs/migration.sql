-- CreateTable
CREATE TABLE "CustomActiveNight" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "nightId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomActiveNight_nightId_fkey" FOREIGN KEY ("nightId") REFERENCES "CustomNight" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomNight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "guildName" TEXT NOT NULL,
    "launchChannelId" TEXT NOT NULL,
    "voiceLobbyChannelId" TEXT NOT NULL,
    "hostDiscordId" TEXT NOT NULL,
    "cohostDiscordIds" TEXT NOT NULL DEFAULT '[]',
    "state" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "snapshot" TEXT NOT NULL,
    "recruitmentMessageId" TEXT,
    "riotTournamentId" TEXT,
    "teamAVoiceChannelId" TEXT,
    "teamBVoiceChannelId" TEXT,
    "currentGameId" TEXT,
    "lastActivityAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CustomConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "disclosureVersion" TEXT NOT NULL,
    "acceptedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CustomNightParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nightId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "readyAt" DATETIME,
    "awayUntil" DATETIME,
    "awayOverdue" BOOLEAN NOT NULL DEFAULT false,
    "held" BOOLEAN NOT NULL DEFAULT false,
    "consentedAt" DATETIME NOT NULL,
    "playerId" INTEGER,
    "playerAlias" TEXT,
    "accountsSnapshot" TEXT NOT NULL DEFAULT '[]',
    "selectedAccountId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomNightParticipant_nightId_fkey" FOREIGN KEY ("nightId") REFERENCES "CustomNight" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomGame" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nightId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "rosterMode" TEXT NOT NULL,
    "map" TEXT NOT NULL,
    "pickMode" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "matchSnapshot" TEXT,
    "activeCaptain" TEXT,
    "tournamentCode" TEXT,
    "riotMatchId" TEXT,
    "winner" TEXT,
    "resultSource" TEXT,
    "resultDisagreement" BOOLEAN NOT NULL DEFAULT false,
    "resultRequestedAt" DATETIME,
    "importedAt" DATETIME,
    "voiceReady" BOOLEAN NOT NULL DEFAULT false,
    "voiceOverride" BOOLEAN NOT NULL DEFAULT false,
    "voiceError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomGame_nightId_fkey" FOREIGN KEY ("nightId") REFERENCES "CustomNight" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomGameParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "playerAlias" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "puuid" TEXT NOT NULL,
    "riotGameName" TEXT,
    "riotTagLine" TEXT,
    "rosterOrder" INTEGER NOT NULL,
    "benchOrder" INTEGER,
    "team" TEXT,
    "side" TEXT,
    "captain" BOOLEAN NOT NULL DEFAULT false,
    "pickOrder" INTEGER,
    "championId" INTEGER,
    "won" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomGameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "CustomGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nightId" TEXT NOT NULL,
    "gameId" TEXT,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ACTIVITY',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomAuditEvent_nightId_fkey" FOREIGN KEY ("nightId") REFERENCES "CustomNight" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomAuditEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "CustomGame" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomActiveNight_nightId_key" ON "CustomActiveNight"("nightId");

-- CreateIndex
CREATE INDEX "CustomNight_guildId_createdAt_idx" ON "CustomNight"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomNight_state_expiresAt_idx" ON "CustomNight"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "CustomConsent_discordId_acceptedAt_idx" ON "CustomConsent"("discordId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomConsent_guildId_discordId_disclosureVersion_key" ON "CustomConsent"("guildId", "discordId", "disclosureVersion");

-- CreateIndex
CREATE INDEX "CustomNightParticipant_nightId_availability_readyAt_idx" ON "CustomNightParticipant"("nightId", "availability", "readyAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomNightParticipant_nightId_discordId_key" ON "CustomNightParticipant"("nightId", "discordId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomGame_tournamentCode_key" ON "CustomGame"("tournamentCode");

-- CreateIndex
CREATE INDEX "CustomGame_state_resultRequestedAt_idx" ON "CustomGame"("state", "resultRequestedAt");

-- CreateIndex
CREATE INDEX "CustomGame_riotMatchId_idx" ON "CustomGame"("riotMatchId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomGame_nightId_sequence_key" ON "CustomGame"("nightId", "sequence");

-- CreateIndex
CREATE INDEX "CustomGameParticipant_gameId_team_pickOrder_idx" ON "CustomGameParticipant"("gameId", "team", "pickOrder");

-- CreateIndex
CREATE INDEX "CustomGameParticipant_puuid_idx" ON "CustomGameParticipant"("puuid");

-- CreateIndex
CREATE UNIQUE INDEX "CustomGameParticipant_gameId_discordId_key" ON "CustomGameParticipant"("gameId", "discordId");

-- CreateIndex
CREATE INDEX "CustomAuditEvent_nightId_revision_idx" ON "CustomAuditEvent"("nightId", "revision");

-- CreateIndex
CREATE INDEX "CustomAuditEvent_gameId_createdAt_idx" ON "CustomAuditEvent"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomAuditEvent_actorId_createdAt_idx" ON "CustomAuditEvent"("actorId", "createdAt");
