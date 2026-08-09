-- CreateTable
CREATE TABLE "guild_config" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "recapChannelId" TEXT,
    "recapCron" TEXT NOT NULL DEFAULT '0 17 * * 5',
    "nextRecapAt" DATETIME,
    "lastRecapAt" DATETIME,
    "enabled" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE INDEX "guild_config_enabled_nextRecapAt_idx" ON "guild_config"("enabled", "nextRecapAt");

