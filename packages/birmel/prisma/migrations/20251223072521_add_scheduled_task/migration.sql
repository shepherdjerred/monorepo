-- CreateTable
CREATE TABLE "ScheduledTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "userId" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "cronPattern" TEXT,
    "naturalDesc" TEXT,
    "toolId" TEXT,
    "toolInput" TEXT,
    "executedAt" DATETIME,
    "nextRun" DATETIME,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ScheduledTask_guildId_idx" ON "ScheduledTask"("guildId");

-- CreateIndex
CREATE INDEX "ScheduledTask_enabled_scheduledAt_idx" ON "ScheduledTask"("enabled", "scheduledAt");
