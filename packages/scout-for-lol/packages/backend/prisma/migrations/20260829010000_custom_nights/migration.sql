CREATE TABLE "CustomNight" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "guildName" TEXT NOT NULL,
    "launchChannelId" TEXT NOT NULL,
    "voiceLobbyChannelId" TEXT NOT NULL,
    "hostDiscordId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "recruitmentMessageId" TEXT,
    "teamAVoiceChannelId" TEXT,
    "teamBVoiceChannelId" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomNight_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomActiveNight" (
    "guildId" TEXT NOT NULL,
    "nightId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomActiveNight_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "CustomNightCohost" (
    "nightId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomNightCohost_pkey" PRIMARY KEY ("nightId", "discordId")
);

CREATE TABLE "CustomConsent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "disclosureVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomNightParticipant" (
    "id" TEXT NOT NULL,
    "nightId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "readyAt" TIMESTAMP(3),
    "awayUntil" TIMESTAMP(3),
    "held" BOOLEAN NOT NULL DEFAULT false,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "playerId" INTEGER,
    "playerAlias" TEXT,
    "selectedAccountId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomNightParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomGame" (
    "id" TEXT NOT NULL,
    "nightId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "rosterMode" TEXT NOT NULL,
    "map" TEXT NOT NULL,
    "pickMode" TEXT NOT NULL,
    "activeCaptain" TEXT,
    "tournamentLobbyId" INTEGER,
    "voiceState" TEXT NOT NULL DEFAULT 'IDLE',
    "voiceReady" BOOLEAN NOT NULL DEFAULT false,
    "voiceOverride" BOOLEAN NOT NULL DEFAULT false,
    "voiceError" TEXT,
    "winner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomGame_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomGameParticipant" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomGameParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomAuditEvent" (
    "id" TEXT NOT NULL,
    "nightId" TEXT NOT NULL,
    "gameId" TEXT,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ACTIVITY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomActiveNight_nightId_key" ON "CustomActiveNight"("nightId");
CREATE INDEX "CustomNight_guildId_createdAt_idx" ON "CustomNight"("guildId", "createdAt");
CREATE INDEX "CustomNight_state_expiresAt_idx" ON "CustomNight"("state", "expiresAt");
CREATE INDEX "CustomConsent_discordId_acceptedAt_idx" ON "CustomConsent"("discordId", "acceptedAt");
CREATE UNIQUE INDEX "CustomConsent_guildId_discordId_disclosureVersion_key" ON "CustomConsent"("guildId", "discordId", "disclosureVersion");
CREATE INDEX "CustomNightParticipant_nightId_availability_readyAt_idx" ON "CustomNightParticipant"("nightId", "availability", "readyAt");
CREATE UNIQUE INDEX "CustomNightParticipant_nightId_discordId_key" ON "CustomNightParticipant"("nightId", "discordId");
CREATE UNIQUE INDEX "CustomGame_tournamentLobbyId_key" ON "CustomGame"("tournamentLobbyId");
CREATE UNIQUE INDEX "CustomGame_nightId_sequence_key" ON "CustomGame"("nightId", "sequence");
CREATE INDEX "CustomGame_nightId_state_idx" ON "CustomGame"("nightId", "state");
CREATE INDEX "CustomGame_voiceState_updatedAt_idx" ON "CustomGame"("voiceState", "updatedAt");
CREATE UNIQUE INDEX "CustomGameParticipant_gameId_discordId_key" ON "CustomGameParticipant"("gameId", "discordId");
CREATE INDEX "CustomGameParticipant_gameId_team_pickOrder_idx" ON "CustomGameParticipant"("gameId", "team", "pickOrder");
CREATE INDEX "CustomGameParticipant_puuid_idx" ON "CustomGameParticipant"("puuid");
CREATE INDEX "CustomAuditEvent_nightId_revision_idx" ON "CustomAuditEvent"("nightId", "revision");
CREATE INDEX "CustomAuditEvent_gameId_createdAt_idx" ON "CustomAuditEvent"("gameId", "createdAt");
CREATE INDEX "CustomAuditEvent_actorId_createdAt_idx" ON "CustomAuditEvent"("actorId", "createdAt");

ALTER TABLE "CustomActiveNight" ADD CONSTRAINT "CustomActiveNight_nightId_fkey" FOREIGN KEY ("nightId") REFERENCES "CustomNight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomNightCohost" ADD CONSTRAINT "CustomNightCohost_nightId_fkey" FOREIGN KEY ("nightId") REFERENCES "CustomNight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomNightParticipant" ADD CONSTRAINT "CustomNightParticipant_nightId_fkey" FOREIGN KEY ("nightId") REFERENCES "CustomNight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomGame" ADD CONSTRAINT "CustomGame_nightId_fkey" FOREIGN KEY ("nightId") REFERENCES "CustomNight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomGame" ADD CONSTRAINT "CustomGame_tournamentLobbyId_fkey" FOREIGN KEY ("tournamentLobbyId") REFERENCES "TournamentLobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomGameParticipant" ADD CONSTRAINT "CustomGameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "CustomGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomAuditEvent" ADD CONSTRAINT "CustomAuditEvent_nightId_fkey" FOREIGN KEY ("nightId") REFERENCES "CustomNight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomAuditEvent" ADD CONSTRAINT "CustomAuditEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "CustomGame"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
