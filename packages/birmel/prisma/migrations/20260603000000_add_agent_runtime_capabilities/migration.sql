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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "AgentJob_legacyTaskId_key" ON "AgentJob"("legacyTaskId");
CREATE INDEX "AgentJob_guildId_status_idx" ON "AgentJob"("guildId", "status");
CREATE INDEX "AgentJob_status_nextRunAt_idx" ON "AgentJob"("status", "nextRunAt");
CREATE INDEX "AgentJob_channelId_idx" ON "AgentJob"("channelId");
CREATE INDEX "AgentJob_threadId_idx" ON "AgentJob"("threadId");
CREATE INDEX "AgentJobRun_jobId_startedAt_idx" ON "AgentJobRun"("jobId", "startedAt");
CREATE INDEX "AgentJobRun_status_startedAt_idx" ON "AgentJobRun"("status", "startedAt");
CREATE INDEX "AgentSession_guildId_status_idx" ON "AgentSession"("guildId", "status");
CREATE INDEX "AgentSession_channelId_status_idx" ON "AgentSession"("channelId", "status");
CREATE INDEX "AgentSession_threadId_status_idx" ON "AgentSession"("threadId", "status");
CREATE INDEX "AgentSession_userId_status_idx" ON "AgentSession"("userId", "status");
CREATE INDEX "AgentSessionEvent_sessionId_createdAt_idx" ON "AgentSessionEvent"("sessionId", "createdAt");
CREATE INDEX "AgentSessionEvent_eventType_createdAt_idx" ON "AgentSessionEvent"("eventType", "createdAt");
CREATE INDEX "AgentMemory_guildId_scope_idx" ON "AgentMemory"("guildId", "scope");
CREATE INDEX "AgentMemory_channelId_idx" ON "AgentMemory"("channelId");
CREATE INDEX "AgentMemory_userId_idx" ON "AgentMemory"("userId");
CREATE INDEX "AgentMemory_sessionId_idx" ON "AgentMemory"("sessionId");
CREATE INDEX "AgentMemory_updatedAt_idx" ON "AgentMemory"("updatedAt");
