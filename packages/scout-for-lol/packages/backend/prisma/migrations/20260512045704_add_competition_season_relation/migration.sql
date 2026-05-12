-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Competition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "serverId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT NOT NULL,
    "criteriaType" TEXT NOT NULL,
    "criteriaConfig" TEXT NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 50,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "seasonId" TEXT,
    "startProcessedAt" DATETIME,
    "endProcessedAt" DATETIME,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL,
    CONSTRAINT "Competition_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Competition" ("channelId", "createdTime", "creatorDiscordId", "criteriaConfig", "criteriaType", "description", "endDate", "endProcessedAt", "id", "isCancelled", "maxParticipants", "ownerId", "seasonId", "serverId", "startDate", "startProcessedAt", "title", "updatedTime", "visibility") SELECT "channelId", "createdTime", "creatorDiscordId", "criteriaConfig", "criteriaType", "description", "endDate", "endProcessedAt", "id", "isCancelled", "maxParticipants", "ownerId", "seasonId", "serverId", "startDate", "startProcessedAt", "title", "updatedTime", "visibility" FROM "Competition";
DROP TABLE "Competition";
ALTER TABLE "new_Competition" RENAME TO "Competition";
CREATE INDEX "Competition_serverId_isCancelled_idx" ON "Competition"("serverId", "isCancelled");
CREATE INDEX "Competition_serverId_ownerId_isCancelled_idx" ON "Competition"("serverId", "ownerId", "isCancelled");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
