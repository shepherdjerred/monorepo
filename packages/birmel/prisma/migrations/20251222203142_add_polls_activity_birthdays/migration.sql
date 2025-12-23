-- CreateTable
CREATE TABLE "DailyPostConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "postTime" TEXT NOT NULL DEFAULT '09:00',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "lastPostAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ServerEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventData" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScheduledAnnouncement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "repeat" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MusicHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "trackUrl" TEXT NOT NULL,
    "trackName" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PollRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "UserActivity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Birthday" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "birthMonth" INTEGER NOT NULL,
    "birthDay" INTEGER NOT NULL,
    "birthYear" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyPostConfig_guildId_key" ON "DailyPostConfig"("guildId");

-- CreateIndex
CREATE INDEX "ServerEvent_guildId_createdAt_idx" ON "ServerEvent"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledAnnouncement_guildId_idx" ON "ScheduledAnnouncement"("guildId");

-- CreateIndex
CREATE INDEX "ScheduledAnnouncement_scheduledAt_idx" ON "ScheduledAnnouncement"("scheduledAt");

-- CreateIndex
CREATE INDEX "MusicHistory_guildId_createdAt_idx" ON "MusicHistory"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PollRecord_messageId_key" ON "PollRecord"("messageId");

-- CreateIndex
CREATE INDEX "PollRecord_guildId_createdAt_idx" ON "PollRecord"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "UserActivity_guildId_userId_createdAt_idx" ON "UserActivity"("guildId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserActivity_guildId_activityType_createdAt_idx" ON "UserActivity"("guildId", "activityType", "createdAt");

-- CreateIndex
CREATE INDEX "Birthday_guildId_birthMonth_birthDay_idx" ON "Birthday"("guildId", "birthMonth", "birthDay");

-- CreateIndex
CREATE UNIQUE INDEX "Birthday_userId_guildId_key" ON "Birthday"("userId", "guildId");
