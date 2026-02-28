-- CreateTable
CREATE TABLE "User" (
    "discordId" TEXT NOT NULL PRIMARY KEY,
    "discordUsername" TEXT NOT NULL,
    "discordAvatar" TEXT,
    "discordAccessToken" TEXT,
    "discordRefreshToken" TEXT,
    "tokenExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'events:write',
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("discordId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesktopClient" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "hostname" TEXT,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeat" DATETIME,
    "currentGameId" TEXT,
    "voiceChannelId" TEXT,
    "guildId" TEXT,
    "activeSoundPackId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DesktopClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("discordId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DesktopClient_activeSoundPackId_fkey" FOREIGN KEY ("activeSoundPackId") REFERENCES "SoundPack" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SoundPack" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "settings" TEXT NOT NULL,
    "defaults" TEXT NOT NULL,
    "rules" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SoundPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("discordId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoredSound" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredSound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("discordId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BotState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "lastSuccessfulPollAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GameEventLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventData" TEXT NOT NULL,
    "soundPlayed" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_token_key" ON "ApiToken"("token");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DesktopClient_clientId_key" ON "DesktopClient"("clientId");

-- CreateIndex
CREATE INDEX "DesktopClient_userId_idx" ON "DesktopClient"("userId");

-- CreateIndex
CREATE INDEX "SoundPack_userId_idx" ON "SoundPack"("userId");

-- CreateIndex
CREATE INDEX "SoundPack_isPublic_idx" ON "SoundPack"("isPublic");

-- CreateIndex
CREATE UNIQUE INDEX "SoundPack_userId_name_key" ON "SoundPack"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StoredSound_s3Key_key" ON "StoredSound"("s3Key");

-- CreateIndex
CREATE INDEX "StoredSound_userId_idx" ON "StoredSound"("userId");

-- CreateIndex
CREATE INDEX "StoredSound_sourceUrl_idx" ON "StoredSound"("sourceUrl");

-- CreateIndex
CREATE INDEX "GameEventLog_userId_timestamp_idx" ON "GameEventLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "GameEventLog_clientId_timestamp_idx" ON "GameEventLog"("clientId", "timestamp");
