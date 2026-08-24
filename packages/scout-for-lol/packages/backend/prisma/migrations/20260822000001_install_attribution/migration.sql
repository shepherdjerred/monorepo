-- AlterTable
ALTER TABLE "GuildInstall" ADD COLUMN "attributedAt" TIMESTAMP(3);
ALTER TABLE "GuildInstall" ADD COLUMN "attributionSurface" TEXT;

-- CreateTable
CREATE TABLE "InstallAttributionToken" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "guildId" TEXT,
    "reconciledAt" TIMESTAMP(3)
);

-- CreateIndex
CREATE UNIQUE INDEX "InstallAttributionToken_token_key" ON "InstallAttributionToken"("token");

-- CreateIndex
CREATE INDEX "InstallAttributionToken_guildId_reconciledAt_idx" ON "InstallAttributionToken"("guildId", "reconciledAt");

-- CreateIndex
CREATE INDEX "InstallAttributionToken_expiresAt_idx" ON "InstallAttributionToken"("expiresAt");
