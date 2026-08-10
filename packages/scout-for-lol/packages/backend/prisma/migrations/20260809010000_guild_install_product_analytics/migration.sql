-- Add a stable, opaque identity for each Scout installation lifecycle.
-- Existing guilds are deliberately excluded from first-value lifecycle events:
-- their prior install/subscription/output history is incomplete, so synthesizing
-- those events would corrupt conversion and retention measurements.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_GuildInstall" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "serverId" TEXT NOT NULL,
  "serverName" TEXT NOT NULL,
  "ownerDiscordId" TEXT NOT NULL,
  "addedByDiscordId" TEXT NOT NULL,
  "memberCount" INTEGER NOT NULL,
  "installedAt" DATETIME NOT NULL,
  "analyticsInstallationId" TEXT NOT NULL,
  "analyticsLifecycleTracked" BOOLEAN NOT NULL DEFAULT true,
  "firstCoreOutputAt" DATETIME,
  "outreach3dSentAt" DATETIME,
  "outreach14dSentAt" DATETIME,
  "outreach30dSentAt" DATETIME,
  "emailNudgeSentAt" DATETIME,
  "removedAt" DATETIME
);

INSERT INTO "new_GuildInstall" (
  "id",
  "serverId",
  "serverName",
  "ownerDiscordId",
  "addedByDiscordId",
  "memberCount",
  "installedAt",
  "analyticsInstallationId",
  "analyticsLifecycleTracked",
  "firstCoreOutputAt",
  "outreach3dSentAt",
  "outreach14dSentAt",
  "outreach30dSentAt",
  "emailNudgeSentAt",
  "removedAt"
)
SELECT
  "id",
  "serverId",
  "serverName",
  "ownerDiscordId",
  "addedByDiscordId",
  "memberCount",
  "installedAt",
  lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', (random() & 3) + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  false,
  NULL,
  "outreach3dSentAt",
  "outreach14dSentAt",
  "outreach30dSentAt",
  "emailNudgeSentAt",
  "removedAt"
FROM "GuildInstall";

DROP TABLE "GuildInstall";
ALTER TABLE "new_GuildInstall" RENAME TO "GuildInstall";
CREATE UNIQUE INDEX "GuildInstall_serverId_key" ON "GuildInstall"("serverId");
CREATE UNIQUE INDEX "GuildInstall_analyticsInstallationId_key" ON "GuildInstall"("analyticsInstallationId");
CREATE INDEX "GuildInstall_installedAt_idx" ON "GuildInstall"("installedAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
