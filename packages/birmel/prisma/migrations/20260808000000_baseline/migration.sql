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

-- CreateTable
CREATE TABLE "GuildOwner" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "currentOwner" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "lastElectionAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ElectionPoll" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "pollType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledStart" DATETIME NOT NULL,
    "scheduledEnd" DATETIME NOT NULL,
    "actualStart" DATETIME,
    "actualEnd" DATETIME,
    "candidates" TEXT NOT NULL,
    "winner" TEXT,
    "voteCounts" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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

-- CreateTable
CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "threadId" TEXT,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "scheduleKind" TEXT NOT NULL,
    "scheduleValue" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "nextRunAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "payloadKind" TEXT NOT NULL DEFAULT 'tool',
    "message" TEXT,
    "toolId" TEXT,
    "toolInput" TEXT,
    "deliveryMode" TEXT NOT NULL DEFAULT 'discord',
    "model" TEXT,
    "reasoningEffort" TEXT,
    "textVerbosity" TEXT,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "timeoutMs" INTEGER NOT NULL DEFAULT 300000,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" DATETIME,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "legacyTaskId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AgentJobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "output" TEXT,
    "error" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentJobRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AgentJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "threadId" TEXT,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "steeringPolicy" TEXT NOT NULL DEFAULT 'steer',
    "model" TEXT,
    "reasoningEffort" TEXT,
    "textVerbosity" TEXT,
    "summary" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AgentSessionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "ownerKey" TEXT,
    "channelId" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "key" TEXT,
    "content" TEXT NOT NULL,
    "tags" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "salience" REAL NOT NULL DEFAULT 0.5,
    "embedding" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EditorSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "threadId" TEXT,
    "messageId" TEXT,
    "repoName" TEXT NOT NULL,
    "sdkSessionId" TEXT,
    "clonedRepoPath" TEXT,
    "state" TEXT NOT NULL DEFAULT 'active',
    "pendingChanges" TEXT,
    "summary" TEXT,
    "prUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GitHubAuth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" DATETIME,
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

-- CreateIndex
CREATE UNIQUE INDEX "GuildOwner_guildId_key" ON "GuildOwner"("guildId");

-- CreateIndex
CREATE INDEX "ElectionPoll_guildId_status_idx" ON "ElectionPoll"("guildId", "status");

-- CreateIndex
CREATE INDEX "ElectionPoll_scheduledStart_idx" ON "ElectionPoll"("scheduledStart");

-- CreateIndex
CREATE INDEX "ScheduledTask_guildId_idx" ON "ScheduledTask"("guildId");

-- CreateIndex
CREATE INDEX "ScheduledTask_enabled_scheduledAt_idx" ON "ScheduledTask"("enabled", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentJob_legacyTaskId_key" ON "AgentJob"("legacyTaskId");

-- CreateIndex
CREATE INDEX "AgentJob_guildId_status_idx" ON "AgentJob"("guildId", "status");

-- CreateIndex
CREATE INDEX "AgentJob_status_nextRunAt_idx" ON "AgentJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "AgentJob_channelId_idx" ON "AgentJob"("channelId");

-- CreateIndex
CREATE INDEX "AgentJob_threadId_idx" ON "AgentJob"("threadId");

-- CreateIndex
CREATE INDEX "AgentJobRun_jobId_startedAt_idx" ON "AgentJobRun"("jobId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentJobRun_status_startedAt_idx" ON "AgentJobRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "AgentSession_guildId_status_idx" ON "AgentSession"("guildId", "status");

-- CreateIndex
CREATE INDEX "AgentSession_channelId_status_idx" ON "AgentSession"("channelId", "status");

-- CreateIndex
CREATE INDEX "AgentSession_threadId_status_idx" ON "AgentSession"("threadId", "status");

-- CreateIndex
CREATE INDEX "AgentSession_userId_status_idx" ON "AgentSession"("userId", "status");

-- CreateIndex
CREATE INDEX "AgentSessionEvent_sessionId_createdAt_idx" ON "AgentSessionEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentSessionEvent_eventType_createdAt_idx" ON "AgentSessionEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMemory_guildId_scope_idx" ON "AgentMemory"("guildId", "scope");

-- CreateIndex
CREATE INDEX "AgentMemory_channelId_idx" ON "AgentMemory"("channelId");

-- CreateIndex
CREATE INDEX "AgentMemory_userId_idx" ON "AgentMemory"("userId");

-- CreateIndex
CREATE INDEX "AgentMemory_sessionId_idx" ON "AgentMemory"("sessionId");

-- CreateIndex
CREATE INDEX "AgentMemory_updatedAt_idx" ON "AgentMemory"("updatedAt");

-- CreateIndex
CREATE INDEX "EditorSession_userId_state_idx" ON "EditorSession"("userId", "state");

-- CreateIndex
CREATE INDEX "EditorSession_guildId_idx" ON "EditorSession"("guildId");

-- CreateIndex
CREATE INDEX "EditorSession_threadId_idx" ON "EditorSession"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubAuth_userId_key" ON "GitHubAuth"("userId");
