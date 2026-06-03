-- Web-UI initiated subscription changes. Every mutation through the web UI
-- records a row so we can audit who added/removed what from outside Discord.
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorDiscordId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetChannelId" TEXT,
    "targetPlayerId" INTEGER,
    "targetAccountId" INTEGER,
    "payload" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT
);

CREATE INDEX "AuditLog_serverId_createdAt_idx" ON "AuditLog"("serverId", "createdAt");

CREATE INDEX "AuditLog_actorDiscordId_createdAt_idx" ON "AuditLog"("actorDiscordId", "createdAt");
