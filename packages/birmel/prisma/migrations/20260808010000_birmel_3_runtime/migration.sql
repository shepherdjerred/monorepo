PRAGMA foreign_keys=OFF;

CREATE TABLE "LegacyAgentRuntimeArchive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceTable" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "archivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "LegacyAgentRuntimeArchive" ("id", "sourceTable", "sourceId", "payload")
SELECT lower(hex(randomblob(16))), 'AgentMemory', "id",
       json_object(
         'guildId', "guildId", 'scope', "scope", 'ownerKey', "ownerKey",
         'channelId', "channelId", 'userId', "userId", 'sessionId', "sessionId",
         'key', "key", 'content', "content", 'tags', "tags",
         'sourceType', "sourceType", 'sourceId', "sourceId",
         'salience', "salience", 'embedding', "embedding",
         'createdAt', "createdAt", 'updatedAt', "updatedAt"
       )
FROM "AgentMemory";

INSERT INTO "LegacyAgentRuntimeArchive" ("id", "sourceTable", "sourceId", "payload")
SELECT lower(hex(randomblob(16))), 'AgentSession', "id",
       json_object(
         'guildId', "guildId", 'channelId', "channelId", 'threadId', "threadId",
         'userId', "userId", 'label', "label", 'status', "status",
         'steeringPolicy', "steeringPolicy", 'model', "model",
         'reasoningEffort', "reasoningEffort", 'textVerbosity', "textVerbosity",
         'summary', "summary", 'expiresAt', "expiresAt",
         'createdAt', "createdAt", 'updatedAt', "updatedAt"
       )
FROM "AgentSession";

INSERT INTO "LegacyAgentRuntimeArchive" ("id", "sourceTable", "sourceId", "payload")
SELECT lower(hex(randomblob(16))), 'AgentSessionEvent', "id",
       json_object(
         'sessionId', "sessionId", 'role', "role", 'eventType', "eventType",
         'content', "content", 'metadata', "metadata", 'createdAt', "createdAt"
       )
FROM "AgentSessionEvent";

CREATE UNIQUE INDEX "LegacyAgentRuntimeArchive_sourceTable_sourceId_key"
ON "LegacyAgentRuntimeArchive"("sourceTable", "sourceId");
CREATE INDEX "LegacyAgentRuntimeArchive_archivedAt_idx"
ON "LegacyAgentRuntimeArchive"("archivedAt");

CREATE TABLE "MemoryClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identityKey" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "salience" REAL NOT NULL,
    "origin" TEXT NOT NULL,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "channelId" TEXT,
    "personaId" TEXT,
    "userId" TEXT,
    "relatedUserIds" TEXT NOT NULL DEFAULT '[]',
    "embedding" TEXT,
    "lastConfirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "MemoryRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousValue" TEXT,
    "nextValue" TEXT,
    "sourceDiscordMessageIds" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "extractorModel" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryRevision_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "MemoryClaim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discordMessageId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "threadId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "persona" TEXT,
    "route" TEXT,
    "status" TEXT NOT NULL DEFAULT 'admitted',
    "responseMessageId" TEXT,
    "incidentId" TEXT,
    "contextCoreCharacters" INTEGER NOT NULL DEFAULT 0,
    "contextPersonaCharacters" INTEGER NOT NULL DEFAULT 0,
    "contextMemoryCharacters" INTEGER NOT NULL DEFAULT 0,
    "contextTranscriptChars" INTEGER NOT NULL DEFAULT 0,
    "selectedMemoryCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "finishReason" TEXT,
    "errorClass" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "new_AgentJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "threadId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "sourceChannelId" TEXT,
    "sourceMessageId" TEXT,
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
    "agentPrompt" TEXT,
    "sessionId" TEXT,
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
    "claimedAt" DATETIME,
    "claimedBy" TEXT,
    "leaseExpiresAt" DATETIME,
    "legacyTaskId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_AgentJob" (
  "id", "guildId", "channelId", "threadId", "actorUserId",
  "sourceChannelId", "name", "description", "scheduleKind", "scheduleValue",
  "timezone", "nextRunAt", "status", "payloadKind", "message", "toolId",
  "toolInput", "deliveryMode", "model", "reasoningEffort", "textVerbosity",
  "maxAttempts", "timeoutMs", "attemptCount", "lastRunAt", "lastStatus",
  "lastError", "legacyTaskId", "createdAt", "updatedAt"
)
SELECT
  "id", "guildId", "channelId", "threadId", "userId", "channelId",
  "name", "description", "scheduleKind", "scheduleValue", "timezone",
  "nextRunAt", "status", "payloadKind", "message", "toolId", "toolInput",
  "deliveryMode", "model", "reasoningEffort", "textVerbosity", "maxAttempts",
  "timeoutMs", "attemptCount", "lastRunAt", "lastStatus", "lastError",
  "legacyTaskId", "createdAt", "updatedAt"
FROM "AgentJob";

INSERT OR IGNORE INTO "new_AgentJob" (
  "id", "guildId", "channelId", "actorUserId", "sourceChannelId", "name",
  "description", "scheduleKind", "scheduleValue", "timezone", "nextRunAt",
  "status", "payloadKind", "message", "toolId", "toolInput", "deliveryMode",
  "maxAttempts", "timeoutMs", "attemptCount", "lastRunAt", "lastStatus",
  "legacyTaskId", "createdAt", "updatedAt"
)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  "guildId", "channelId", "userId", "channelId", "name", "description",
  CASE WHEN "cronPattern" IS NULL THEN 'at' ELSE 'cron' END,
  COALESCE("cronPattern", CAST("scheduledAt" AS TEXT)), 'UTC',
  CASE WHEN "executedAt" IS NULL THEN COALESCE("nextRun", "scheduledAt") ELSE NULL END,
  CASE WHEN "enabled" = false THEN 'cancelled'
       WHEN "executedAt" IS NOT NULL THEN 'completed' ELSE 'active' END,
  CASE WHEN "toolId" IS NULL THEN 'message' ELSE 'tool' END,
  CASE WHEN "toolId" IS NULL THEN "naturalDesc" ELSE NULL END,
  "toolId", "toolInput", 'discord', 3, 300000,
  CASE WHEN "executedAt" IS NULL THEN 0 ELSE 1 END,
  "executedAt",
  CASE WHEN "executedAt" IS NULL THEN NULL ELSE 'completed' END,
  "id", "createdAt", "updatedAt"
FROM "ScheduledTask";

DROP TABLE "AgentJob";
ALTER TABLE "new_AgentJob" RENAME TO "AgentJob";
DROP TABLE "ScheduledTask";
DROP TABLE "AgentSessionEvent";
DROP TABLE "AgentSession";
DROP TABLE "AgentMemory";

CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "summary" TEXT,
    "summaryVersion" INTEGER NOT NULL DEFAULT 1,
    "summaryThroughSequence" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME,
    "archivedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AgentSessionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "discordMessageId" TEXT,
    "toolId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentJob_legacyTaskId_key" ON "AgentJob"("legacyTaskId");
CREATE INDEX "AgentJob_guildId_status_idx" ON "AgentJob"("guildId", "status");
CREATE INDEX "AgentJob_status_nextRunAt_idx" ON "AgentJob"("status", "nextRunAt");
CREATE INDEX "AgentJob_channelId_idx" ON "AgentJob"("channelId");
CREATE INDEX "AgentJob_threadId_idx" ON "AgentJob"("threadId");
CREATE INDEX "AgentJob_sessionId_idx" ON "AgentJob"("sessionId");
CREATE INDEX "AgentJob_leaseExpiresAt_idx" ON "AgentJob"("leaseExpiresAt");

CREATE UNIQUE INDEX "AgentSession_threadId_key" ON "AgentSession"("threadId");
CREATE INDEX "AgentSession_guildId_status_idx" ON "AgentSession"("guildId", "status");
CREATE INDEX "AgentSession_channelId_status_idx" ON "AgentSession"("channelId", "status");
CREATE INDEX "AgentSession_actorUserId_status_idx" ON "AgentSession"("actorUserId", "status");
CREATE UNIQUE INDEX "AgentSessionEvent_sessionId_sequence_key" ON "AgentSessionEvent"("sessionId", "sequence");
CREATE UNIQUE INDEX "AgentSessionEvent_sessionId_discordMessageId_key" ON "AgentSessionEvent"("sessionId", "discordMessageId");
CREATE INDEX "AgentSessionEvent_eventType_createdAt_idx" ON "AgentSessionEvent"("eventType", "createdAt");

CREATE UNIQUE INDEX "MemoryClaim_identityKey_key" ON "MemoryClaim"("identityKey");
CREATE INDEX "MemoryClaim_guildId_scope_status_idx" ON "MemoryClaim"("guildId", "scope", "status");
CREATE INDEX "MemoryClaim_channelId_idx" ON "MemoryClaim"("channelId");
CREATE INDEX "MemoryClaim_personaId_idx" ON "MemoryClaim"("personaId");
CREATE INDEX "MemoryClaim_userId_idx" ON "MemoryClaim"("userId");
CREATE INDEX "MemoryClaim_guildId_subject_predicate_idx" ON "MemoryClaim"("guildId", "subject", "predicate");
CREATE INDEX "MemoryClaim_lastConfirmedAt_idx" ON "MemoryClaim"("lastConfirmedAt");
CREATE INDEX "MemoryRevision_claimId_createdAt_idx" ON "MemoryRevision"("claimId", "createdAt");
CREATE INDEX "MemoryRevision_sourceDiscordMessageIds_idx" ON "MemoryRevision"("sourceDiscordMessageIds");

CREATE UNIQUE INDEX "AgentRun_discordMessageId_key" ON "AgentRun"("discordMessageId");
CREATE UNIQUE INDEX "AgentRun_incidentId_key" ON "AgentRun"("incidentId");
CREATE INDEX "AgentRun_guildId_createdAt_idx" ON "AgentRun"("guildId", "createdAt");
CREATE INDEX "AgentRun_channelId_createdAt_idx" ON "AgentRun"("channelId", "createdAt");
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

PRAGMA foreign_keys=ON;
