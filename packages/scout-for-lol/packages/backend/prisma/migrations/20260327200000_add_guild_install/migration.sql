-- CreateTable
CREATE TABLE "GuildInstall" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverId" TEXT NOT NULL,
    "serverName" TEXT NOT NULL,
    "ownerDiscordId" TEXT NOT NULL,
    "addedByDiscordId" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "installedAt" DATETIME NOT NULL,
    "outreach3dSentAt" DATETIME,
    "outreach14dSentAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildInstall_serverId_key" ON "GuildInstall"("serverId");

-- CreateIndex
CREATE INDEX "GuildInstall_installedAt_idx" ON "GuildInstall"("installedAt");
