-- Central audit log of every direct message (DM) the bot sends to a user.
-- All DMs flow through `sendDM` (discord/utils/dm.ts), which writes one row here
-- per attempt so DMs are fully traceable. Append-only.
CREATE TABLE "DmAuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recipientId" TEXT NOT NULL,
    "recipientTag" TEXT,
    "guildId" TEXT,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "DmAuditLog_recipientId_createdAt_idx" ON "DmAuditLog"("recipientId", "createdAt");

CREATE INDEX "DmAuditLog_kind_createdAt_idx" ON "DmAuditLog"("kind", "createdAt");

CREATE INDEX "DmAuditLog_guildId_createdAt_idx" ON "DmAuditLog"("guildId", "createdAt");
