-- AlterTable
ALTER TABLE "GuildInstall" ADD COLUMN "attributedAt" DATETIME;
ALTER TABLE "GuildInstall" ADD COLUMN "attributionSurface" TEXT;

-- CreateTable
CREATE TABLE "InstallAttributionToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "guildId" TEXT,
    "reconciledAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "InstallAttributionToken_token_key" ON "InstallAttributionToken"("token");

-- CreateIndex
CREATE INDEX "InstallAttributionToken_guildId_reconciledAt_idx" ON "InstallAttributionToken"("guildId", "reconciledAt");

-- CreateIndex
CREATE INDEX "InstallAttributionToken_expiresAt_idx" ON "InstallAttributionToken"("expiresAt");
