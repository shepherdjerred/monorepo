-- Tournament-code custom lobbies.
--
-- Provider/tournament registrations are long-lived and keyed by (apiMode,
-- region): stub and live IDs are different namespaces, so a code minted under
-- the stub is meaningless under the live API.
CREATE TABLE "TournamentRegistration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "apiMode" TEXT NOT NULL,
    "tournamentRegion" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "TournamentRegistration_apiMode_tournamentRegion_key"
ON "TournamentRegistration"("apiMode", "tournamentRegion");

-- One Scout-created lobby, from minted code to delivered report. Kept separate
-- from ActiveGame, which is keyed by a match ID that does not exist until a
-- game starts and is hard-deleted by the 3-hour TTL sweep.
CREATE TABLE "TournamentLobby" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "apiMode" TEXT NOT NULL,
    "providerId" INTEGER NOT NULL,
    "tournamentId" INTEGER NOT NULL,
    "region" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "bluePuuids" TEXT NOT NULL,
    "redPuuids" TEXT NOT NULL,
    "blueAliases" TEXT NOT NULL,
    "redAliases" TEXT NOT NULL,
    "teamSize" INTEGER NOT NULL,
    "pickType" TEXT NOT NULL,
    "mapType" TEXT NOT NULL,
    "spectatorType" TEXT NOT NULL,
    "lobbyName" TEXT,
    "password" TEXT,
    "state" TEXT NOT NULL,
    "processedEventCount" INTEGER NOT NULL DEFAULT 0,
    "lastEventTimestamp" TEXT,
    "prematchMessageIds" TEXT,
    "joinedPuuids" TEXT NOT NULL DEFAULT '[]',
    "gameId" BIGINT,
    "matchId" TEXT,
    "lastPolledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "TournamentLobby_code_key" ON "TournamentLobby"("code");
CREATE INDEX "TournamentLobby_state_expiresAt_idx" ON "TournamentLobby"("state", "expiresAt");
CREATE INDEX "TournamentLobby_serverId_state_idx" ON "TournamentLobby"("serverId", "state");
CREATE INDEX "TournamentLobby_matchId_idx" ON "TournamentLobby"("matchId");
