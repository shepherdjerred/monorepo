-- Persist conversions instead of recomputing them from live subscriptions.
--
-- `cleanupRemovedGuild` deletes a removed guild's subscriptions, so a converted
-- guild that later churned lost its evidence and the next recompute SUBTRACTED
-- it — a historical experiment result that goes down over time. Scoped to
-- `installedAt` so a re-install cannot inherit the previous installation's
-- credit, or donate its new subscription to an old message.
CREATE TABLE "OutreachConversion" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "serverId" TEXT NOT NULL,
  "installedAt" DATETIME NOT NULL,
  "ladderStage" INTEGER NOT NULL,
  "convertedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "OutreachConversion_serverId_installedAt_key" ON "OutreachConversion"("serverId", "installedAt");
CREATE INDEX "OutreachConversion_ladderStage_idx" ON "OutreachConversion"("ladderStage");
